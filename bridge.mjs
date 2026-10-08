import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { providerConfig, providerClient } from './provider.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeId = (s) => typeof s === 'string' && /^[a-zA-Z0-9_]{1,160}$/.test(s);

export function validateRequest(r, instance, token, now = Date.now() / 1000) {
  const fail = () => { throw new Error('INVALID_REQUEST'); };
  if (!r || r.protocol !== 1 || !safeId(r.id) || !safeId(r.session)
    || r.instance !== instance || r.token !== token || !Number.isInteger(r.sequence) || r.sequence < 1
    || !Number.isInteger(r.createdAt) || now - r.createdAt > 12 || r.createdAt - now > 2
    || typeof r.pinyin !== 'string' || !/^[a-z ']{1,80}$/.test(r.pinyin)
    || !Number.isInteger(r.caret) || r.caret !== r.pinyin.length
    || typeof r.preedit !== 'string' || r.preedit.length > 300
    || typeof r.context !== 'string' || [...r.context].length > 80
    || !Array.isArray(r.candidates) || r.candidates.length < 2 || r.candidates.length > 10) fail();
  if (r.document !== undefined) {
    const d = r.document;
    if (!d || d.source !== 'tsf' || !['exact', 'unavailable'].includes(d.quality)
      || typeof d.stamp !== 'string' || !/^[0-9-]{0,60}$/.test(d.stamp)
      || (d.quality === 'exact' && !d.stamp) || (d.quality !== 'exact' && r.context !== '')
      || /[\p{Cs}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffc]/u.test(r.context)) fail();
  } else if (r.context !== '') {
    // Old adapters have only commit history, never authoritative document text.
    fail();
  }
  for (const c of r.candidates) {
    if (!c || typeof c.text !== 'string' || !c.text.length || c.text.length > 300
      || !Number.isInteger(c.start) || !Number.isInteger(c.end)
      || c.start < 0 || c.end <= c.start || c.end > r.pinyin.length) fail();
  }
  return { pinyin: r.pinyin, preedit: r.preedit, topK: r.candidates.length,
    candidates: r.candidates.map((c, i) => ({ id: `c${i + 1}`, text: c.text, originalRank: i + 1 })) };
}

export function resultOrder(result, count) {
  const original = Array.from({ length: count }, (_, i) => i + 1);
  const top = result.ranked[0];
  const runnerUp = Math.max(result.ranked[1]?.probability ?? 0, result.noneProbability);
  if (result.abstained || top.probability < 0.6 || top.probability - runnerUp < 0.15) return null;
  // Only promote the winner; preserve all other ranks and every later page.
  return [top.originalRank, ...original.filter((i) => i !== top.originalRank)];
}

export async function atomicWrite(filename, contents) {
  const temp = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  await fs.writeFile(temp, contents, { mode: 0o600 });
  try { await fs.rename(temp, filename); }
  finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}

export async function startBridge({ root, apiKey = '', mock = false, callLimit = 200, timeoutMs = 4000, provider = {}, debounceMs = 350 }) {
  if (!Number.isInteger(callLimit) || callLimit < 1 || callLimit > 10000) throw new Error('Invalid callLimit');
  if (!Number.isInteger(debounceMs) || debounceMs < 0 || debounceMs > 2000) throw new Error('Invalid debounceMs');
  provider = providerConfig(provider);
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
  const client = providerClient(provider, { apiKey, callLimit, timeoutMs });
  const ledgerPath = path.join(root, 'usage.json');
  const today = () => new Date().toISOString().slice(0, 10);
  let ledger = { day: today(), calls: 0 };
  try {
    const saved = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(saved.day) || !Number.isInteger(saved.calls) || saved.calls < 0) throw new Error('Invalid usage ledger');
    if (saved.day === today()) ledger = saved;
  } catch (error) { if (error.code !== 'ENOENT') { await fs.unlink(lockPath); throw error; } }
  let stopped = false, heartbeatAt = 0, lastCall = 0, active = null, lastError = null;
  const seen = new Map();
  const beat = async () => {
    await atomicWrite(path.join(runtime, 'bridge.info'), `JEVWIN1\n${instance}\n${token}\n${mode}\n${Math.floor(Date.now() / 1000)}\n`);
    await atomicWrite(path.join(root, 'status.json'), JSON.stringify({ mode, pid: process.pid,
      endpoint: provider.endpoint, model: provider.model, protocol: provider.protocol,
      auth: provider.auth, keyConfigured: Boolean(apiKey),
      callsToday: ledger.calls, callLimit, lastError, updatedAt: new Date().toISOString() }, null, 2));
  };
  const exists = async (filename) => { try { await fs.access(filename); return true; } catch { return false; } };
  const respond = async (r, filename, status, value) => {
    if (!await exists(filename) || stopped || Date.now() / 1000 - r.createdAt > 12) return;
    const result = [r.document ? 'JEVWIN2' : 'JEVWIN1', r.id, instance, status,
      String(r.createdAt + 12), String(r.candidates.length), value,
      ...(r.document ? [r.document.stamp] : []), ''].join('\n');
    await atomicWrite(path.join(runtime, 'outbox', `${r.id}.res`), result);
    await fs.rm(filename, { force: true });
  };
  const handle = async (filename) => {
    let r;
    try {
      const stat = await fs.stat(filename);
      if (stat.size > 20000) throw new Error('INVALID_REQUEST');
      r = JSON.parse(await fs.readFile(filename, 'utf8'));
      const snapshot = validateRequest(r, instance, token);
      if (`${r.id}.json` !== path.basename(filename)) throw new Error('INVALID_REQUEST');
      await sleep(debounceMs);
      if (stopped || !await exists(filename)) return;
      const previous = seen.get(r.session);
      if (previous && r.sequence <= previous.sequence) throw new Error('REPLAY');
      seen.set(r.session, { sequence: r.sequence, at: Date.now() });
      if (mode === 'offline') { await respond(r, filename, 'error', 'KEY_MISSING'); return; }
      if (Date.now() - lastCall < 1000) { await respond(r, filename, 'error', 'RATE_LIMITED'); return; }
      if (ledger.day !== today()) { ledger = { day: today(), calls: 0 }; client.calls = 0; }
      if (ledger.calls >= callLimit) { await respond(r, filename, 'error', 'DAILY_BUDGET_EXCEEDED'); return; }
      lastCall = Date.now();
      let order;
      if (mock) {
        await sleep(100);
        order = [2, 1, ...Array.from({ length: snapshot.candidates.length - 2 }, (_, i) => i + 3)];
      } else {
        // Persist the attempt BEFORE sending. A restart must not reset the daily cap.
        ledger.calls++;
        await atomicWrite(ledgerPath, JSON.stringify(ledger));
        const controller = new AbortController();
        const watch = setInterval(() => { exists(filename).then((yes) => { if (!yes || stopped) controller.abort(); }); }, 80);
        try { order = resultOrder(await client.rank(snapshot, r.context, { confirmLive: true, signal: controller.signal }), snapshot.candidates.length); }
        finally { clearInterval(watch); }
      }
      lastError = null;
      await respond(r, filename, order ? 'ok' : 'abstain', order ? order.join(',') : 'UNCHANGED');
    } catch (error) {
      lastError = /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'INVALID_REQUEST';
      if (r && safeId(r.id) && Array.isArray(r.candidates) && r.instance === instance && r.token === token) {
        await respond(r, filename, 'error', lastError).catch(() => {});
      }
      await fs.rm(filename, { force: true }).catch(() => {});
    }
  };
  const loop = (async () => {
    try {
      while (!stopped) {
        if (Date.now() - heartbeatAt > 1000) { await beat(); heartbeatAt = Date.now(); }
        if (!active) {
          const files = (await fs.readdir(path.join(runtime, 'inbox'))).filter((f) => /^[a-zA-Z0-9_]+\.json$/.test(f)).sort();
          if (files[0]) active = handle(path.join(runtime, 'inbox', files[0])).finally(() => { active = null; });
        }
        for (const folder of ['inbox', 'outbox']) {
          for (const name of await fs.readdir(path.join(runtime, folder))) {
            const filename = path.join(runtime, folder, name);
            try {
              if ((await fs.stat(filename)).mtimeMs < Date.now() - 15000) await fs.unlink(filename);
            } catch (e) { if (e.code !== 'ENOENT') throw e; }
          }
        }
        for (const [key, value] of seen) if (Date.now() - value.at > 30000) seen.delete(key);
        await sleep(80);
      }
    } finally {
      stopped = true;
      if (active) await active;
      await fs.rm(path.join(runtime, 'bridge.info'), { force: true });
      await fs.rm(lockPath, { force: true });
    }
  })();
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
    callLimit: config.callLimit ?? 200, provider: config.provider ?? {}, debounceMs: config.debounceMs ?? 350 });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void bridge.stop(); });
  await bridge.done;
}
