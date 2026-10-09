import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const PROTOCOL = 'nebula.runtime';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const READ_METHODS = new Set(['runtime.describe', 'runtime.snapshot', 'pane.procs', 'pane.read']);
const fail = (code) => Object.assign(new Error(code), { code });
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function contextProviderConfig(value) {
  if (value === undefined || value === null) return null;
  if (!value || value.type !== 'pebrel-codex' || typeof value.cli !== 'string'
    || !path.isAbsolute(value.cli) || path.basename(value.cli).toLowerCase() !== 'pebrel.exe'
    || Object.keys(value).some((key) => !['type', 'cli'].includes(key))) {
    throw new Error('Invalid contextProvider; expected {type: "pebrel-codex", cli: absolute Pebrel executable}');
  }
  return { type: value.type, cli: value.cli };
}

function endpointFrom(value) {
  const parts = typeof value === 'string' && /^(\d{1,5}) ([a-f0-9]{32,128})$/.exec(value.trim());
  if (!parts || !integer(Number(parts[1]), 1, 65535)) return null;
  return { port: Number(parts[1]), token: parts[2] };
}

function envelope(response, id) {
  if (!response || response.protocol !== PROTOCOL || response.version !== 1 || response.id !== id) {
    throw fail('CONTEXT_RUNTIME_INVALID');
  }
  if (!response.ok) throw fail('CONTEXT_RUNTIME_UNAVAILABLE');
  return response.result;
}

// Only the documented local Runtime API is used. No port-file/process scan,
// clipboard, OCR, key injection, or access to Codex conversation storage.
export class PebrelRuntime {
  constructor({ cli, env = process.env, run = exec } = {}) {
    this.cli = cli;
    this.endpoint = endpointFrom(env.PEBREL_RUNTIME_ENDPOINT);
    this.run = run;
    this.serial = 0;
  }

  async connect(signal) {
    if (this.endpoint) return;
    if (!this.cli) throw fail('CONTEXT_RUNTIME_UNAVAILABLE');
    const options = { windowsHide: true, timeout: 1500, maxBuffer: MAX_RESPONSE_BYTES, encoding: 'utf8', signal };
    try {
      const description = JSON.parse((await this.run(this.cli, ['ctl', 'describe'], options)).stdout);
      if (!description.ok || !description.result?.features?.includes('pane.exec.non_tty')) {
        throw fail('CONTEXT_RUNTIME_UNSUPPORTED');
      }
      const response = JSON.parse((await this.run(this.cli, ['ctl', 'snapshot'], options)).stdout);
      if (!response.ok) throw fail('CONTEXT_RUNTIME_UNAVAILABLE');
      const scope = focusedScope(response.result);
      // After autostart or a Pebrel restart, acquire the exported environment
      // via a finite non-TTY child, not by guessing private discovery files.
      const script = 'process.stdout.write(process.env.PEBREL_RUNTIME_ENDPOINT || "")';
      const result = JSON.parse((await this.run(this.cli, ['ctl', 'exec-pane', '--window', String(scope.window),
        '--pane', String(scope.pane), '--', process.execPath, '-e', script], options)).stdout);
      const output = result.result;
      if (!result.ok || output?.exit_code !== 0 || output?.timed_out
        || output?.capture?.stdout?.truncated || output?.capture?.stderr?.truncated) {
        throw fail('CONTEXT_RUNTIME_UNAVAILABLE');
      }
      this.endpoint = endpointFrom(output.stdout);
      if (!this.endpoint) throw fail('CONTEXT_RUNTIME_UNAVAILABLE');
    } catch (error) {
      if (signal?.aborted) throw fail('CANCELLED');
      throw fail(error.code?.startsWith('CONTEXT_') ? error.code : 'CONTEXT_RUNTIME_UNAVAILABLE');
    }
  }

  async request(method, params = {}, { signal } = {}) {
    if (!READ_METHODS.has(method)) throw fail('CONTEXT_RUNTIME_INVALID');
    if (signal?.aborted) throw fail('CANCELLED');
    await this.connect(signal);
    const id = `jev-context-${++this.serial}`;
    const request = { protocol: PROTOCOL, version: 1, id, token: this.endpoint.token, method, params };
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port: this.endpoint.port });
        const chunks = [];
        let size = 0, settled = false;
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          socket.destroy();
          if (error) reject(error); else resolve(result);
        };
        const abort = () => finish(fail('CANCELLED'));
        const timer = setTimeout(() => finish(fail('CONTEXT_RUNTIME_TIMEOUT')), 2000);
        signal?.addEventListener('abort', abort, { once: true });
        socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
        socket.once('error', () => finish(fail('CONTEXT_RUNTIME_UNAVAILABLE')));
        socket.once('end', () => finish(fail('CONTEXT_RUNTIME_UNAVAILABLE')));
        socket.on('data', (data) => {
          size += data.length;
          if (size > MAX_RESPONSE_BYTES) { finish(fail('CONTEXT_RUNTIME_INVALID')); return; }
          const newline = data.indexOf(10);
          chunks.push(newline < 0 ? data : data.subarray(0, newline));
          if (newline >= 0) {
            try { finish(null, envelope(JSON.parse(Buffer.concat(chunks).toString('utf8')), id)); }
            catch (error) { finish(fail(error.code ?? 'CONTEXT_RUNTIME_INVALID')); }
          }
        });
        if (signal?.aborted) abort();
      });
    } catch (error) {
      if (error.code !== 'CANCELLED') this.endpoint = null;
      throw error;
    }
  }
}

export function focusedScope(snapshot) {
  if (!snapshot || !integer(snapshot.process_id, 1, 0xffffffff) || !Array.isArray(snapshot.windows)) {
    throw fail('CONTEXT_RUNTIME_INVALID');
  }
  const windows = snapshot.windows.filter((window) => window.focused === true);
  if (windows.length !== 1) throw fail('CONTEXT_NOT_FOCUSED');
  const window = windows[0];
  const tabs = window.tabs?.filter((tab) => tab.active === true && tab.index === window.active_tab);
  if (tabs?.length !== 1 || tabs[0].kind !== 'shell') throw fail('CONTEXT_NOT_FOCUSED');
  const tab = tabs[0];
  const panes = tab.panes?.filter((pane) => pane.active === true && pane.id === window.focused_pane_id
    && pane.id === tab.focused_pane_id);
  if (panes?.length !== 1 || panes[0].ssh_destination) throw fail('CONTEXT_NOT_FOCUSED');
  if (panes[0].agent?.kind && panes[0].agent.kind !== 'codex') throw fail('CONTEXT_NOT_CODEX');
  if (!integer(window.id, 1, 0xffffffff) || !integer(panes[0].id, 1, 0xffffffff)
    || typeof tab.tab_id !== 'string' || !/^[a-f0-9]{32}$/i.test(tab.tab_id)) throw fail('CONTEXT_RUNTIME_INVALID');
  const session = panes[0].agent?.kind === 'codex' ? panes[0].agent.session_id : null;
  if (session !== null && session !== undefined && (typeof session !== 'string' || session.length > 128)) {
    throw fail('CONTEXT_RUNTIME_INVALID');
  }
  return { process: snapshot.process_id, window: window.id, pane: panes[0].id, tab: tab.tab_id,
    key: `${snapshot.process_id}/${window.id}/${tab.tab_id}/${panes[0].id}/${session ?? ''}` };
}

function rowCells(row, columns) {
  if (!Array.isArray(row) || row.length < 1 || row.length > columns) throw fail('CONTEXT_INPUT_UNSUPPORTED');
  let x = 0;
  return row.map((cell) => {
    if (!Array.isArray(cell) || cell.length !== 5 || typeof cell[0] !== 'string' || !cell[0]
      || Buffer.byteLength(cell[0], 'utf8') > 256 || !integer(cell[1], 1, 2)
      || !integer(cell[2], -269, 0xffffff) || !integer(cell[3], -269, 0xffffff)
      || !integer(cell[4], 0, 63) || /[\p{Cc}\p{Cs}]/u.test(cell[0])) throw fail('CONTEXT_INPUT_UNSUPPORTED');
    const result = { text: cell[0], start: x, end: x + cell[1], bg: cell[3], flags: cell[4] };
    x = result.end;
    return result;
  }).map((cell) => {
    if (x !== columns) throw fail('CONTEXT_INPUT_UNSUPPORTED');
    return cell;
  });
}

// This deliberately recognizes one tested Codex composer layout, not arbitrary
// text near a terminal cursor. Unknown layouts must not expose transcript rows.
export function codexInputContext(screen) {
  if (!screen || screen.version !== 1 || !integer(screen.columns, 4, 400)
    || !Array.isArray(screen.rows) || !integer(screen.rows.length, 5, 200)
    || screen.rows.length * screen.columns > 40000 || !Array.isArray(screen.cursor)
    || screen.cursor.length !== 3 || screen.cursor[2] !== 1
    || !integer(screen.cursor[0], 2, screen.columns - 1)
    || !integer(screen.cursor[1], 1, screen.rows.length - 3) || screen.history) {
    throw fail('CONTEXT_INPUT_UNSUPPORTED');
  }
  const [x, y] = screen.cursor;
  const rows = screen.rows.map((row) => rowCells(row, screen.columns));
  if (Buffer.byteLength(rows.flatMap((row) => row.map((cell) => cell.text)).join('')) > 128 * 1024) {
    throw fail('CONTEXT_INPUT_UNSUPPORTED');
  }
  const background = rows[y][0].bg;
  const sameBackground = (row) => row.every((cell) => cell.bg === background);
  if (!sameBackground(rows[y])) throw fail('CONTEXT_INPUT_UNSUPPORTED');
  let top = y, bottom = y;
  while (top > 0 && sameBackground(rows[top - 1])) top--;
  while (bottom + 1 < rows.length && sameBackground(rows[bottom + 1])) bottom++;
  const text = (row) => row.map((cell) => cell.text).join('');
  const blank = (row) => /^ +$/.test(text(row));
  if (top < 1 || bottom - top < 2 || bottom - top > 18 || rows.length - bottom < 2
    || rows.length - bottom > 5 || !blank(rows[top]) || !blank(rows[bottom]) || y <= top || y >= bottom) {
    throw fail('CONTEXT_INPUT_UNSUPPORTED');
  }
  const first = rows[top + 1];
  if (first[0].text !== '\u203a' || first[0].end !== 1 || !(first[0].flags & 1)
    || first[1].text !== ' ' || first[1].end !== 2) throw fail('CONTEXT_INPUT_UNSUPPORTED');
  const prefix = [];
  for (let line = top + 1; line < bottom; line++) {
    const row = rows[line];
    if (line > top + 1 && (row[0].text !== ' ' || row[0].end !== 1 || row[1].text !== ' ' || row[1].end !== 2)) {
      throw fail('CONTEXT_INPUT_UNSUPPORTED');
    }
    // Hidden cells and attachment/paste placeholders cannot stand in for text.
    if (row.some((cell) => cell.flags & 32) || /\[(?:Pasted|Image|File|Attachment)\b/i.test(text(row))) {
      throw fail('CONTEXT_INPUT_UNSUPPORTED');
    }
    if (line > y) continue;
    const end = line === y ? x : screen.columns;
    if (row.some((cell) => cell.start < end && cell.end > end)) throw fail('CONTEXT_INPUT_UNSUPPORTED');
    const content = row.filter((cell) => cell.start >= 2 && cell.end <= end);
    if (content.some((cell) => cell.flags & 16)) throw fail('CONTEXT_INPUT_UNSUPPORTED');
    prefix.push(line === y ? text(content) : text(content).replace(/ +$/, ''));
  }
  // TUI-drawn row breaks do not carry a reliable hard/soft-wrap distinction.
  // Keep a separator rather than inventing text by joining adjacent words.
  const preceding = Array.from(prefix.join('\n')).slice(-80).join('');
  const fingerprint = createHash('sha256').update(JSON.stringify({ columns: screen.columns, x, y, top, bottom,
    rows: screen.rows.slice(top, bottom + 1) })).digest('hex');
  const empty = y === top + 1 && x === 2 && rows.slice(top + 1, bottom)
    .every((row) => row.filter((cell) => cell.start >= 2).every((cell) => cell.text === ' ' || (cell.flags & 16)));
  return { text: preceding, fingerprint, empty };
}

function codexIdentity(result, scope) {
  if (result?.window_id !== scope.window || result?.pane_id !== scope.pane
    || !integer(result.root_pid, 1, 0xffffffff) || !Array.isArray(result.processes)) throw fail('CONTEXT_RUNTIME_INVALID');
  const codex = result.processes.filter((item) => item.agent_kind === 'codex'
    && item.executable?.toLowerCase() === 'codex.exe' && integer(item.pid, 1, 0xffffffff));
  if (!codex.length) throw fail('CONTEXT_NOT_CODEX');
  return `${result.root_pid}/${codex.map((item) => item.pid).sort((a, b) => a - b).join(',')}`;
}

export class PebrelContextReader {
  constructor({ runtime, cli, now = Date.now } = {}) {
    this.runtime = runtime ?? new PebrelRuntime({ cli });
    this.now = now;
    this.scope = null;
    this.stableSince = 0;
    this.supported = false;
  }

  async observe(signal) {
    let scope;
    try { scope = focusedScope(await this.runtime.request('runtime.snapshot', {}, { signal })); }
    catch (error) { this.scope = null; this.stableSince = this.now(); throw error; }
    if (scope.key !== this.scope?.key) this.stableSince = this.now();
    this.scope = scope;
    return scope;
  }

  async warm() {
    try { await this.observe(AbortSignal.timeout(2000)); } catch { /* No focused terminal is normal at startup. */ }
  }

  async capture({ publishedAt = Infinity, signal } = {}) {
    if (!this.supported) {
      const description = await this.runtime.request('runtime.describe', {}, { signal });
      if (!description?.features?.includes('pane.read.screen.v1')
        || !['runtime.snapshot', 'pane.procs', 'pane.read'].every((method) => description.capabilities?.includes(method))) {
        throw fail('CONTEXT_RUNTIME_UNSUPPORTED');
      }
      this.supported = true;
    }
    const scope = await this.observe(signal);
    // A request predating an observed focus/pane change cannot be assigned to
    // the newly focused pane. Wait for the next real IME snapshot instead.
    if (publishedAt < this.stableSince) throw fail('CONTEXT_FOCUS_CHANGED');
    const params = { window_id: scope.window, pane_id: scope.pane };
    const identity = codexIdentity(await this.runtime.request('pane.procs', params, { signal }), scope);
    const result = await this.runtime.request('pane.read', { ...params, lines: 1, screen: true }, { signal });
    if (result?.window_id !== scope.window || result?.pane_id !== scope.pane || result.exited !== false) {
      throw fail('CONTEXT_RUNTIME_INVALID');
    }
    const context = codexInputContext(result.screen);
    const after = await this.observe(signal);
    if (after.key !== scope.key) throw fail('CONTEXT_FOCUS_CHANGED');
    return { text: context.text, stamp: `${scope.key}/${identity}/${context.fingerprint}` };
  }

  async verify(captured, { signal } = {}) {
    const fresh = await this.capture({ signal });
    if (fresh.stamp !== captured.stamp) throw fail('CONTEXT_CHANGED');
  }
}
