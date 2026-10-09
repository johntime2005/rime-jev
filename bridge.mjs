import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { providerConfig, CONTINUATION_PROMPT_VERSION } from './provider.mjs';
import { IsolatedProvider } from './provider-isolate.mjs';
import { contextProviderConfig, PebrelContextReader } from './context-pebrel.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeId = (s) => typeof s === 'string' && /^[a-zA-Z0-9_]{1,160}$/.test(s);
const POLL_MS = 20;
const CANCEL_REASONS = new Set(['session_closed', 'adapter_error', 'auto_toggle', 'context_option_changed',
  'app_changed', 'snapshot_changed', 'expired', 'committed', 'input_changed', 'caret_changed',
  'ascii_mode', 'focus_changed', 'manual_selection', 'manual_clear', 'escape', 'enter', 'shortcut', 'editing', 'navigation']);
const CONTEXT_REASONS = new Set([...CANCEL_REASONS, 'disabled', 'available', 'session_start', 'idle_timeout', 'newline',
  'context_pending', 'document_empty', 'context_unavailable']);
const CONTEXT_ERRORS = new Set(['CONTEXT_RUNTIME_UNAVAILABLE', 'CONTEXT_RUNTIME_INVALID', 'CONTEXT_RUNTIME_UNSUPPORTED',
  'CONTEXT_RUNTIME_TIMEOUT', 'CONTEXT_NOT_FOCUSED', 'CONTEXT_FOCUS_CHANGED', 'CONTEXT_NOT_CODEX',
  'CONTEXT_INPUT_UNSUPPORTED', 'CONTEXT_CHANGED', 'CONTEXT_READER_TIMEOUT']);

function contextState(r) {
  const value = r.contextState;
  if (value === undefined) return null; // Older adapters/probes do not report this.
  if (!value || typeof value.enabled !== 'boolean' || !CONTEXT_REASONS.has(value.reason)
    || (!value.enabled && (value.reason !== 'disabled' || r.context !== ''))
    || (value.enabled && (value.reason === 'disabled' || (value.reason === 'available') !== (r.context !== '')))) {
    throw new Error('INVALID_REQUEST');
  }
  // Reconstruct the object: unknown fields must not become a text logging path.
  const safe = { enabled: value.enabled, reason: value.reason };
  if (value.source !== undefined) {
    if (!['none', 'history', 'pebrel_codex'].includes(value.source)
      || (value.source === 'none' && r.context !== '')
      || (value.source === 'history' && (!value.enabled || r.context === ''))
      || (value.source === 'pebrel_codex' && (!value.enabled || r.contextTarget !== 'pebrel'))) {
      throw new Error('INVALID_REQUEST');
    }
    safe.source = value.source;
  }
  return safe;
}

export function validateRequest(r, instance, token, now = Date.now() / 1000) {
  const fail = () => { throw new Error('INVALID_REQUEST'); };
  if (!r || r.protocol !== 1 || !safeId(r.id) || !safeId(r.session)
    || r.instance !== instance || r.token !== token || !Number.isInteger(r.sequence) || r.sequence < 1
    || !Number.isInteger(r.createdAt) || now - r.createdAt > 12 || r.createdAt - now > 2
    || typeof r.pinyin !== 'string' || !/^[a-z ']{1,80}$/.test(r.pinyin)
    || !Number.isInteger(r.caret) || r.caret !== r.pinyin.length
    || typeof r.preedit !== 'string' || r.preedit.length > 300
    || typeof r.context !== 'string' || [...r.context].length > 80
    || (r.cacheEpoch !== undefined && (!Number.isSafeInteger(r.cacheEpoch) || r.cacheEpoch < 0))
    || !Array.isArray(r.candidates) || r.candidates.length < 2 || r.candidates.length > 10) fail();
  for (const c of r.candidates) {
    if (!c || typeof c.text !== 'string' || !c.text.length || c.text.length > 300
      || !Number.isInteger(c.start) || !Number.isInteger(c.end)
      || c.start < 0 || c.end <= c.start || c.end > r.pinyin.length) fail();
  }
  const state = contextState(r);
  if (r.contextTarget !== undefined && r.contextTarget !== null
    && (r.contextTarget !== 'pebrel' || r.context !== '' || state?.enabled !== true
      || state.reason !== 'context_pending' || state.source !== 'pebrel_codex')) fail();
  if (state?.reason === 'context_pending' && r.contextTarget !== 'pebrel') fail();
  return { pinyin: r.pinyin, preedit: r.preedit, topK: r.candidates.length,
    candidates: r.candidates.map((c, i) => ({ id: `c${i + 1}`, text: c.text, originalRank: i + 1 })) };
}

export function rankDecision(result, count) {
  const original = Array.from({ length: count }, (_, i) => i + 1);
  const top = result.ranked[0];
  const runnerUp = Math.max(result.ranked[1]?.probability ?? 0, result.noneProbability);
  const margin = top.probability - runnerUp;
  const reason = result.abstained ? 'provider_abstained' : top.probability < 0.6 ? 'low_probability'
    : margin < 0.15 ? 'narrow_margin' : 'accepted';
  // Only promote the winner; preserve all other ranks and every later page.
  return { order: reason === 'accepted' ? [top.originalRank, ...original.filter((i) => i !== top.originalRank)] : null,
    reason, topOriginalRank: top.originalRank, topProbability: top.probability,
    runnerUpProbability: runnerUp, noneProbability: result.noneProbability, margin,
    minProbability: 0.6, minMargin: 0.15 };
}

export function resultOrder(result, count) {
  return rankDecision(result, count).order;
}

export async function atomicWrite(filename, contents, { rename = fs.rename } = {}) {
  const temp = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  await fs.writeFile(temp, contents, { mode: 0o600 });
  try {
    // Lua's Windows CRT reader briefly holds a non-delete-sharing handle.
    // Retry only this local atomic replacement, never a provider request.
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, filename); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
        await sleep(10 * 2 ** attempt);
      }
    }
  }
  finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}

export async function startBridge({ root, apiKey = '', mock = false, callLimit = 200, timeoutMs = 4000, provider = {},
  debounceMs = 100, cacheTtlMs = 15000, workerUrl, contextProvider, contextReader }) {
  if (!Number.isInteger(callLimit) || callLimit < 1 || callLimit > 10000) throw new Error('Invalid callLimit');
  if (!Number.isInteger(debounceMs) || debounceMs < 0 || debounceMs > 2000) throw new Error('Invalid debounceMs');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000) throw new Error('Invalid timeoutMs');
  if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 15000) throw new Error('Invalid cacheTtlMs');
  provider = providerConfig(provider);
  contextProvider = contextProviderConfig(contextProvider);
  const documentContext = contextReader ?? (contextProvider ? new PebrelContextReader({ cli: contextProvider.cli }) : null);
  const runtime = path.join(root, 'runtime');
  await fs.mkdir(path.join(runtime, 'inbox'), { recursive: true });
  await fs.mkdir(path.join(runtime, 'outbox'), { recursive: true });
  const lockPath = path.join(runtime, 'bridge.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const oldPid = Number(await fs.readFile(lockPath, 'utf8'));
    if (!Number.isInteger(oldPid) || oldPid <= 0) throw new Error('Invalid lock file; inspect before removing');
    let alive = true;
    try { process.kill(oldPid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
    if (alive) throw new Error('Bridge already running');
    await fs.unlink(lockPath);
    lock = await fs.open(lockPath, 'wx');
  }
  await lock.writeFile(String(process.pid));
  await lock.close();
  const instance = randomBytes(16).toString('hex'), token = randomBytes(32).toString('hex');
  const mode = mock ? 'mock' : (apiKey || provider.auth === 'none') ? 'live' : 'offline';
  const client = new IsolatedProvider({ provider, apiKey, timeoutMs, workerUrl });
  const ledgerPath = path.join(root, 'usage.json');
  const today = () => new Date().toISOString().slice(0, 10);
  let ledger = { day: today(), calls: 0 };
  try {
    const saved = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(saved.day) || !Number.isInteger(saved.calls) || saved.calls < 0) throw new Error('Invalid usage ledger');
    if (saved.day === today()) ledger = saved;
  } catch (error) { if (error.code !== 'ENOENT') { await fs.unlink(lockPath); throw error; } }
  let stopped = false, heartbeatAt = 0, cleanupAt = 0, active = null, lastError = null;
  let lastResult = null, statusDirty = false, infoAt = 0, requestState = null;
  let lastCancellation = null, lastAdapterCancellation = null;
  const cancellationsByPhase = {}, adapterCancellations = {};
  const seen = new Map(), deliveries = new Map();
  // Only hashed exact snapshots and numeric decisions, scoped to this process/session.
  const cache = new Map(), cacheMetrics = { hits: 0, misses: 0 };
  const outcomes = { promoted: 0, sameFirst: 0, abstained: 0, errors: 0, cancelled: 0,
    nativeApplied: 0, otherApplied: 0, unacknowledged: 0 };
  const beat = async () => {
    if (Date.now() - infoAt >= 1000) {
      await atomicWrite(path.join(runtime, 'bridge.info'), `JEVWIN1\n${instance}\n${token}\n${mode}\n${Math.floor(Date.now() / 1000)}\n`);
      infoAt = Date.now();
    }
    await atomicWrite(path.join(root, 'status.json'), JSON.stringify({ mode, pid: process.pid,
      endpoint: provider.endpoint, model: provider.model, protocol: provider.protocol,
      promptVersion: provider.allowNone ? CONTINUATION_PROMPT_VERSION : 'ime-completion-v3-object',
      auth: provider.auth, keyConfigured: Boolean(apiKey),
      callsToday: ledger.calls, callLimit, debounceMs, pollMs: POLL_MS, localMinIntervalMs: 0,
      timeoutMs, providerIsolation: 'worker', providerWorker: client.metrics,
      contextProvider: documentContext ? 'pebrel-codex' : 'none',
      cache: { ...cacheMetrics, ttlMs: cacheTtlMs, entries: cache.size },
      requestState: requestState ? { phase: requestState.phase, ageMs: Math.max(0, Date.now() - requestState.startedAt) } : null,
      outcomes, cancellationsByPhase, lastCancellation, adapterCancellations, lastAdapterCancellation,
      lastResult, lastError, updatedAt: new Date().toISOString() }, null, 2));
  };
  const exists = async (filename) => { try { await fs.access(filename); return true; } catch { return false; } };
  const readContext = async (operation, filename) => {
    if (stopped || !await exists(filename)) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
    const controller = new AbortController();
    let timer, watch;
    const interrupted = new Promise((_, reject) => {
      const stop = (code) => { controller.abort(); reject(Object.assign(new Error(code), { code })); };
      timer = setTimeout(() => stop('CONTEXT_READER_TIMEOUT'), 4000);
      watch = setInterval(() => { exists(filename).then((yes) => { if (!yes || stopped) stop('CANCELLED'); }); }, POLL_MS);
    });
    try {
      return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), interrupted]);
    } finally { clearTimeout(timer); clearInterval(watch); controller.abort(); }
  };
  const respond = async (r, filename, status, value, timing) => {
    if (!await exists(filename) || stopped || Date.now() / 1000 - r.createdAt > 12) return false;
    const result = ['JEVWIN1', r.id, instance, status, String(r.createdAt + 12), String(r.candidates.length), value, ''].join('\n');
    await atomicWrite(path.join(runtime, 'outbox', `${r.id}.res`), result);
    const winner = status === 'ok' ? Number(value.split(',')[0]) : null;
    const decision = status === 'ok' ? winner === 1 ? 'same_first' : 'promoted' : status;
    lastError = status === 'error' ? value : null;
    if (status === 'ok') outcomes[winner === 1 ? 'sameFirst' : 'promoted']++;
    else outcomes[status === 'abstain' ? 'abstained' : 'errors']++;
    const readyAt = Date.now();
    // Only timings/rank numbers are retained, never text, credentials, or provider bodies.
    lastResult = { requestId: r.id, decision, winnerOriginalRank: winner, providerMs: timing?.providerMs ?? null,
      readyMs: timing ? Math.round(readyAt - timing.submittedAt) : null,
      contextChars: timing?.contextChars ?? null, candidateCount: r.candidates.length,
      contextState: timing?.contextState ?? null,
      contextError: timing?.contextError ?? null,
      contextReadMs: timing?.contextReadMs ?? null, contextVerifyMs: timing?.contextVerifyMs ?? null,
      source: timing?.source ?? (mock ? 'mock' : 'provider'), cacheAgeMs: timing?.cacheAgeMs ?? null,
      transport: timing?.transport ?? null,
      localMs: timing ? Math.max(0, Math.round(readyAt - timing.submittedAt - (timing.providerMs ?? 0))) : null,
      discoveryMs: timing?.discoveryMs ?? null,
      ranking: timing?.ranking ?? null,
      applyMs: null, applyChannel: 'not_observed', completedAt: new Date(readyAt).toISOString() };
    deliveries.set(r.id, { readyAt, result: lastResult, acknowledged: false });
    statusDirty = true;
    await fs.rm(filename, { force: true });
    return true;
  };
  const collectCancellations = async () => {
    for (const name of await fs.readdir(path.join(runtime, 'outbox'))) {
      if (!/^[a-zA-Z0-9_]{1,160}\.cancel$/.test(name)) continue;
      const filename = path.join(runtime, 'outbox', name);
      try {
        const stat = await fs.stat(filename);
        if (stat.size > 1024) continue;
        const receipt = JSON.parse(await fs.readFile(filename, 'utf8'));
        if (receipt.protocol !== 1 || !safeId(receipt.id) || `${receipt.id}.cancel` !== name
          || receipt.instance !== instance || receipt.token !== token || !CANCEL_REASONS.has(receipt.reason)
          || !Number.isInteger(receipt.createdAt) || Date.now() / 1000 - receipt.createdAt > 15
          || receipt.createdAt - Date.now() / 1000 > 2) continue;
        adapterCancellations[receipt.reason] = (adapterCancellations[receipt.reason] ?? 0) + 1;
        if (!lastAdapterCancellation || receipt.createdAt >= lastAdapterCancellation.createdAt) {
          lastAdapterCancellation = { requestId: receipt.id, reason: receipt.reason,
            createdAt: receipt.createdAt, observedAt: new Date().toISOString() };
        }
        statusDirty = true;
      } catch { /* Optional diagnostics must not break ordinary typing. */ }
      finally { await fs.rm(filename, { force: true }).catch(() => {}); }
    }
  };
  const collectAcknowledgements = async () => {
    for (const [id, delivery] of deliveries) {
      const filename = path.join(runtime, 'outbox', `${id}.ack`);
      if (!delivery.acknowledged) {
        try {
          const stat = await fs.stat(filename);
          if (stat.size > 1024) throw new Error('Invalid acknowledgement');
          const ack = JSON.parse(await fs.readFile(filename, 'utf8'));
          if (ack.protocol !== 1 || ack.id !== id || ack.instance !== instance
            || !['native', 'diagnostic', 'filter'].includes(ack.channel)) throw new Error('Invalid acknowledgement');
          delivery.acknowledged = true;
          delivery.result.applyMs = Math.max(0, Math.round(stat.mtimeMs - delivery.readyAt));
          delivery.result.applyChannel = ack.channel;
          outcomes[ack.channel === 'native' ? 'nativeApplied' : 'otherApplied']++;
          statusDirty = true;
        } catch (error) { if (error.code !== 'ENOENT') await fs.rm(filename, { force: true }); }
        if (delivery.acknowledged) {
          await fs.rm(filename, { force: true });
          deliveries.delete(id);
        }
      }
      if (Date.now() - delivery.readyAt > 15000) {
        if (!delivery.acknowledged) { outcomes.unacknowledged++; statusDirty = true; }
        deliveries.delete(id);
      }
    }
  };
  const handle = async (filename) => {
    let r, timing, capturedContext;
    const cancelled = () => {
      outcomes.cancelled++;
      const phase = requestState?.phase ?? 'unknown';
      cancellationsByPhase[phase] = (cancellationsByPhase[phase] ?? 0) + 1;
      lastCancellation = { requestId: path.basename(filename, '.json'), phase,
        contextChars: timing?.contextChars ?? null, contextState: timing?.contextState ?? null,
        ageMs: timing ? Math.max(0, Math.round(Date.now() - timing.submittedAt)) : null,
        observedAt: new Date().toISOString() };
    };
    try {
      const stat = await fs.stat(filename);
      if (stat.size > 20000) throw new Error('INVALID_REQUEST');
      r = JSON.parse(await fs.readFile(filename, 'utf8'));
      const snapshot = validateRequest(r, instance, token);
      if (`${r.id}.json` !== path.basename(filename)) throw new Error('INVALID_REQUEST');
      timing = { submittedAt: stat.mtimeMs, discoveryMs: Math.max(0, Math.round(Date.now() - stat.mtimeMs)),
        providerMs: null, contextChars: [...r.context].length, contextState: contextState(r) };
      let cacheKey = createHash('sha256').update(JSON.stringify([r.session, r.cacheEpoch ?? null,
        r.contextState?.enabled ?? null, r.context, r.pinyin, r.caret, r.preedit, r.candidates])).digest('hex');
      // A document read must precede cache lookup; identical IME input can now
      // refer to a different draft, caret, pane, or foreground window.
      const cached = r.contextTarget ? null : cache.get(cacheKey);
      const previous = seen.get(r.session);
      if (previous && r.sequence <= previous.sequence) throw new Error('REPLAY');
      if (mode === 'live' && cached && Date.now() - cached.at < cacheTtlMs) {
        requestState = { phase: 'cache', startedAt: Date.now() };
        seen.set(r.session, { sequence: r.sequence, at: Date.now() });
        timing.source = 'cache'; timing.providerMs = 0;
        timing.cacheAgeMs = Date.now() - cached.at; timing.ranking = cached.ranking;
        if (await respond(r, filename, cached.order ? 'ok' : 'abstain', cached.order ? cached.order.join(',') : 'UNCHANGED', timing)) {
          cacheMetrics.hits++; lastError = null;
        } else cancelled();
        return;
      }
      // Overlap local worker initialization with debounce, never a speculative API call.
      if (mode === 'live') client.warm();
      requestState = { phase: 'debounce', startedAt: Date.now() };
      statusDirty = true;
      // Debounce from publication, not discovery. Retire replaced input promptly
      // instead of making the next snapshot wait out the old one's entire delay.
      while (Date.now() - stat.mtimeMs < debounceMs) {
        if (stopped || !await exists(filename)) { cancelled(); return; }
        await sleep(Math.min(POLL_MS, Math.max(1, debounceMs - (Date.now() - stat.mtimeMs))));
      }
      if (stopped || !await exists(filename)) { cancelled(); return; }
      seen.set(r.session, { sequence: r.sequence, at: Date.now() });
      if (mode === 'offline') { await respond(r, filename, 'error', 'KEY_MISSING', timing); return; }
      if (r.contextTarget === 'pebrel') {
        requestState = { phase: 'context', startedAt: Date.now() };
        statusDirty = true;
        if (!documentContext) throw Object.assign(new Error('CONTEXT_RUNTIME_UNAVAILABLE'), { code: 'CONTEXT_RUNTIME_UNAVAILABLE' });
        const contextStarted = performance.now();
        try {
          capturedContext = await readContext((signal) => documentContext.capture({ publishedAt: stat.mtimeMs, signal }), filename);
        } finally { timing.contextReadMs = Math.round(performance.now() - contextStarted); }
        if (!capturedContext || typeof capturedContext.text !== 'string' || [...capturedContext.text].length > 80
          || typeof capturedContext.stamp !== 'string' || !capturedContext.stamp || capturedContext.stamp.length > 512) {
          throw Object.assign(new Error('CONTEXT_RUNTIME_INVALID'), { code: 'CONTEXT_RUNTIME_INVALID' });
        }
        r.context = capturedContext.text;
        timing.contextChars = [...r.context].length;
        timing.contextState = { enabled: true, reason: r.context ? 'available' : 'document_empty', source: 'pebrel_codex' };
        cacheKey = createHash('sha256').update(JSON.stringify([cacheKey, capturedContext.stamp, r.context])).digest('hex');
        const documentCached = cache.get(cacheKey);
        if (mode === 'live' && documentCached && Date.now() - documentCached.at < cacheTtlMs) {
          requestState = { phase: 'context_verify', startedAt: Date.now() };
          const verifyStarted = performance.now();
          try { await readContext((signal) => documentContext.verify(capturedContext, { signal }), filename); }
          finally { timing.contextVerifyMs = Math.round(performance.now() - verifyStarted); }
          timing.source = 'cache'; timing.providerMs = 0;
          timing.cacheAgeMs = Date.now() - documentCached.at; timing.ranking = documentCached.ranking;
          if (await respond(r, filename, documentCached.order ? 'ok' : 'abstain',
            documentCached.order ? documentCached.order.join(',') : 'UNCHANGED', timing)) cacheMetrics.hits++;
          else cancelled();
          return;
        }
      }
      if (ledger.day !== today()) ledger = { day: today(), calls: 0 };
      if (ledger.calls >= callLimit) { await respond(r, filename, 'error', 'DAILY_BUDGET_EXCEEDED', timing); return; }
      let order;
      requestState = { phase: mock ? 'provider' : 'ledger', startedAt: Date.now() };
      statusDirty = true;
      if (mock) {
        await sleep(100);
        order = [2, 1, ...Array.from({ length: snapshot.candidates.length - 2 }, (_, i) => i + 3)];
      } else {
        // Persist the attempt BEFORE sending. A restart must not reset the daily cap.
        ledger.calls++;
        cacheMetrics.misses++;
        await atomicWrite(ledgerPath, JSON.stringify(ledger));
        if (stopped || !await exists(filename)) { cancelled(); return; }
        requestState = { phase: 'provider', startedAt: Date.now() };
        statusDirty = true;
        const controller = new AbortController();
        const watch = setInterval(() => { exists(filename).then((yes) => { if (!yes || stopped) controller.abort(); }); }, POLL_MS);
        const started = performance.now();
        try {
          const result = await client.rank(snapshot, r.context, { signal: controller.signal });
          const decision = rankDecision(result, snapshot.candidates.length);
          timing.transport = result.timings ?? null;
          ({ order } = decision);
          const { order: ignored, ...ranking } = decision;
          timing.ranking = ranking;
        }
        finally { timing.providerMs = Math.round(performance.now() - started); clearInterval(watch); }
      }
      if (capturedContext) {
        requestState = { phase: 'context_verify', startedAt: Date.now() };
        statusDirty = true;
        const verifyStarted = performance.now();
        try { await readContext((signal) => documentContext.verify(capturedContext, { signal }), filename); }
        finally { timing.contextVerifyMs = Math.round(performance.now() - verifyStarted); }
      }
      lastError = null;
      requestState = { phase: 'publish', startedAt: Date.now() };
      statusDirty = true;
      if (!await respond(r, filename, order ? 'ok' : 'abstain', order ? order.join(',') : 'UNCHANGED', timing)) cancelled();
      else if (mode === 'live' && cacheTtlMs > 0) {
        cache.delete(cacheKey);
        cache.set(cacheKey, { at: Date.now(), order, ranking: timing.ranking });
        if (cache.size > 32) cache.delete(cache.keys().next().value);
      }
    } catch (error) {
      if (error.code === 'CANCELLED' || error.code === 'ENOENT') { cancelled(); return; }
      if (CONTEXT_ERRORS.has(error.code) && r && timing) {
        // Keep the original candidates rather than request an answer with stale
        // commit history, an unknown input field, or a changed document snapshot.
        timing.contextError = error.code;
        timing.contextState = { enabled: true, reason: 'context_unavailable', source: capturedContext ? 'pebrel_codex' : 'none' };
        timing.ranking = null;
        if (!capturedContext) timing.contextChars = 0;
        r.context = '';
        await respond(r, filename, 'abstain', 'UNCHANGED', timing).catch(() => {});
        return;
      }
      lastError = /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'INVALID_REQUEST';
      if (r && safeId(r.id) && Array.isArray(r.candidates) && r.instance === instance && r.token === token) {
        requestState = { phase: 'publish', startedAt: Date.now() };
        statusDirty = true;
        await respond(r, filename, 'error', lastError, timing).catch(() => {});
      }
      await fs.rm(filename, { force: true }).catch(() => {});
    } finally {
      requestState = null;
      statusDirty = true;
    }
  };
  const loop = (async () => {
    try {
      while (!stopped) {
        await collectCancellations();
        await collectAcknowledgements();
        if (statusDirty || Date.now() - heartbeatAt > 1000) {
          statusDirty = false;
          await beat(); heartbeatAt = Date.now();
        }
        if (!active) {
          const files = (await fs.readdir(path.join(runtime, 'inbox'))).filter((f) => /^[a-zA-Z0-9_]+\.json$/.test(f)).sort();
          if (files[0]) active = handle(path.join(runtime, 'inbox', files[0])).finally(() => { active = null; });
        }
        if (Date.now() - cleanupAt > 1000) {
          cleanupAt = Date.now();
          for (const folder of ['inbox', 'outbox']) {
            for (const name of await fs.readdir(path.join(runtime, folder))) {
              const filename = path.join(runtime, folder, name);
              try {
                if ((await fs.stat(filename)).mtimeMs < Date.now() - 15000) await fs.unlink(filename);
              } catch (e) { if (e.code !== 'ENOENT') throw e; }
            }
          }
          for (const [key, value] of seen) if (Date.now() - value.at > 30000) seen.delete(key);
          for (const [key, value] of cache) if (Date.now() - value.at >= cacheTtlMs) cache.delete(key);
        }
        await sleep(POLL_MS);
      }
    } finally {
      stopped = true;
      if (active) await active;
      await client.close();
      await fs.rm(path.join(runtime, 'bridge.info'), { force: true });
      await fs.rm(lockPath, { force: true });
    }
  })();
  if (documentContext?.warm) void Promise.resolve(documentContext.warm()).catch(() => {});
  if (mode === 'live') client.warm();
  return { instance, token, mode, runtime, stop: async () => { stopped = true; await loop; }, done: loop };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root || !path.isAbsolute(root)) throw new Error('Usage: node bridge.mjs ABSOLUTE_DATA_DIR');
  let config = {};
  try { config = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  // No command line mock mode: simulated rankings must never leak into the real IME.
  const bridge = await startBridge({ root, apiKey: process.env.TYPESAFE_API_KEY || '',
    callLimit: config.callLimit ?? 200, provider: config.provider ?? {}, debounceMs: config.debounceMs ?? 100,
    cacheTtlMs: config.cacheTtlMs ?? 15000, contextProvider: config.contextProvider });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void bridge.stop(); });
  await bridge.done;
}
