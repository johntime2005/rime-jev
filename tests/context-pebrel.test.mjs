import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { codexInputContext, focusedScope, contextProviderConfig, PebrelContextReader, PebrelRuntime } from '../context-pebrel.mjs';

const columns = 48, background = 0x474747;
function row(text, bg = -258, flags = 0) {
  const cells = Array.from(text, (char) => [char, /[\u2e80-\ua4cf\u{1f300}-\u{1faff}]/u.test(char) ? 2 : 1, -257, bg, flags]);
  let width = cells.reduce((total, cell) => total + cell[1], 0);
  while (width++ < columns) cells.push([' ', 1, -257, bg, 0]);
  return cells;
}
function screen(lines = ['hello'], { x, line = lines.length - 1 } = {}) {
  const input = lines.map((text, i) => {
    const cells = row(`${i ? ' ' : '\u203a'} ${text}`, background);
    if (!i) cells[0][4] = 1;
    return cells;
  });
  return { version: 1, columns, palette: [],
    rows: [row('PRIVATE TRANSCRIPT - MUST NOT BECOME CONTEXT'), row(''), row('', background),
      ...input, row('', background), row('status'), row('shortcuts')],
    cursor: [x ?? row(lines[line]).filter((c) => c[0] !== ' ').reduce((total, c) => total + c[1], 0) + 2, 3 + line, 1] };
}
function snapshot({ focused = true, pane = 1 } = {}) {
  return { process_id: 123, windows: [{ id: 1, focused, active_tab: 0, focused_pane_id: pane,
    tabs: [{ tab_id: 'a'.repeat(32), index: 0, active: true, kind: 'shell', focused_pane_id: pane,
      panes: [{ id: pane, active: true, ssh_destination: null }] }] }] };
}
function runtimeFixture() {
  const state = { snapshot: snapshot(), screen: screen(), calls: [], codex: true, readHook: null };
  state.request = async (method, params) => {
    state.calls.push(method);
    if (method === 'runtime.describe') return { features: ['pane.read.screen.v1'],
      capabilities: ['runtime.snapshot', 'pane.procs', 'pane.read'] };
    if (method === 'runtime.snapshot') return state.snapshot;
    if (method === 'pane.procs') return { ...params, root_pid: 12, processes: state.codex
      ? [{ pid: 13, agent_kind: 'codex', executable: 'codex.exe' }] : [] };
    if (method === 'pane.read') {
      state.readHook?.();
      return { window_id: params.window_id, pane_id: params.pane_id, exited: false, screen: state.screen };
    }
    throw new Error('Unexpected method');
  };
  return state;
}

test('reads only the colored Codex draft before the terminal caret, not history or suffix', () => {
  const frame = screen(['hello world'], { x: 7 });
  const result = codexInputContext(frame);
  assert.equal(result.text, 'hello');
  assert.ok(!result.text.includes('PRIVATE'));
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  const moved = codexInputContext(screen(['hello world'], { x: 5 }));
  assert.equal(moved.text, 'hel');
  assert.notEqual(result.fingerprint, moved.fingerprint);
  assert.notEqual(result.fingerprint, codexInputContext(screen(['hello there'], { x: 7 })).fingerprint);
});

test('handles CJK widths, emoji, multiline input and the 80-code-point bound', () => {
  assert.equal(codexInputContext(screen(['\u4f60\u597d\u{1f600}test'], { x: 8 })).text, '\u4f60\u597d\u{1f600}');
  assert.equal(codexInputContext(screen(['one', 'two words'], { x: 5 })).text, 'one\ntwo');
  const long = codexInputContext(screen(['a'.repeat(40), 'b'.repeat(40), 'tail'], { x: 6 })).text;
  assert.equal([...long].length, 80);
  assert.ok(long.endsWith('\ntail'));
  const invalid = screen(['\u4f60\u597d'], { x: 3 });
  assert.throws(() => codexInputContext(invalid), { code: 'CONTEXT_INPUT_UNSUPPORTED' });
});

test('empty composer is valid but dim placeholders never become input', () => {
  const frame = screen(['Ask Codex to do anything'], { x: 2 });
  for (const cell of frame.rows[3].slice(2)) cell[4] = 16;
  assert.equal(codexInputContext(frame).text, '');
  frame.cursor[0] = 5;
  assert.throws(() => codexInputContext(frame), { code: 'CONTEXT_INPUT_UNSUPPORTED' });
});

test('fails closed for unknown layouts, hidden text, attachments and malformed grids', () => {
  const bad = [
    (s) => { s.cursor[2] = 0; },
    (s) => { s.cursor[1] = 0; },
    (s) => { s.rows[3][0][0] = '$'; },
    (s) => { s.rows[3][0][4] = 0; },
    (s) => { s.rows[2] = row('not blank', background); },
    (s) => { s.rows[3][2][4] = 32; },
    (s) => { s.rows[3][3][3] = -258; },
    (s) => { s.rows[3][2][0] = '\u001b'; },
    (s) => { s.rows[3][2][0] = '\ud800'; },
    (s) => { s.rows[3].pop(); },
    (s) => { s.history = { first: 0 }; },
    (s) => { s.rows[3] = row('\u203a [Pasted Content 10 chars]', background); s.rows[3][0][4] = 1; },
  ];
  for (const mutate of bad) {
    const frame = screen(); mutate(frame);
    assert.throws(() => codexInputContext(frame), { code: 'CONTEXT_INPUT_UNSUPPORTED' });
  }
});

test('requires a unique focused local shell pane, not the remembered active pane', () => {
  assert.equal(focusedScope(snapshot()).pane, 1);
  assert.throws(() => focusedScope(snapshot({ focused: false })), { code: 'CONTEXT_NOT_FOCUSED' });
  const cases = [
    (s) => { s.windows.push(structuredClone(s.windows[0])); },
    (s) => { s.windows[0].tabs[0].kind = 'conversation'; },
    (s) => { s.windows[0].tabs[0].panes[0].ssh_destination = 'remote'; },
    (s) => { s.windows[0].focused_pane_id = 2; },
    (s) => { s.windows[0].tabs[0].active = false; },
  ];
  for (const mutate of cases) {
    const value = snapshot(); mutate(value);
    assert.throws(() => focusedScope(value), { code: 'CONTEXT_NOT_FOCUSED' });
  }
});

test('reader checks runtime capability, actual Codex process and pane before and after read', async () => {
  const runtime = runtimeFixture();
  const reader = new PebrelContextReader({ runtime, now: () => 100 });
  await reader.warm();
  const captured = await reader.capture({ publishedAt: 101 });
  assert.equal(captured.text, 'hello');
  await reader.verify(captured);
  runtime.screen = screen(['changed']);
  await assert.rejects(reader.verify(captured), { code: 'CONTEXT_CHANGED' });
  runtime.codex = false;
  await assert.rejects(reader.capture(), { code: 'CONTEXT_NOT_CODEX' });
  runtime.codex = true;
  runtime.readHook = () => { runtime.snapshot = snapshot({ pane: 2 }); };
  await assert.rejects(reader.capture(), { code: 'CONTEXT_FOCUS_CHANGED' });
});

test('new focus cannot claim older pending requests and no screen is read without focus', async () => {
  const runtime = runtimeFixture();
  const reader = new PebrelContextReader({ runtime, now: () => 200 });
  await assert.rejects(reader.capture({ publishedAt: 100 }), { code: 'CONTEXT_FOCUS_CHANGED' });
  assert.ok(!runtime.calls.includes('pane.read'));
  runtime.snapshot = snapshot({ focused: false });
  await assert.rejects(reader.capture(), { code: 'CONTEXT_NOT_FOCUSED' });
  assert.ok(!runtime.calls.includes('pane.read'));
});

test('a restarted Codex session is not the old document snapshot', async () => {
  const runtime = runtimeFixture();
  const reader = new PebrelContextReader({ runtime, now: () => 200 });
  runtime.snapshot.windows[0].tabs[0].panes[0].agent = { kind: 'codex', session_id: 'session-one' };
  const before = await reader.capture();
  runtime.snapshot.windows[0].tabs[0].panes[0].agent.session_id = 'session-two';
  await assert.rejects(reader.verify(before), { code: 'CONTEXT_CHANGED' });
  runtime.snapshot.windows[0].tabs[0].panes[0].agent.kind = 'claude';
  await assert.rejects(reader.capture(), { code: 'CONTEXT_NOT_CODEX' });
});

test('validates explicit context-provider configuration without persisting runtime credentials', () => {
  assert.equal(contextProviderConfig(undefined), null);
  const cli = path.resolve('pebrel.exe');
  assert.deepEqual(contextProviderConfig({ type: 'pebrel-codex', cli }), { type: 'pebrel-codex', cli });
  for (const value of [{ type: 'pebrel-codex', cli: 'pebrel.exe' }, { type: 'other', cli },
    { type: 'pebrel-codex', cli, token: 'secret' }, { type: 'pebrel-codex', cli: path.resolve('other.exe') }]) {
    assert.throws(() => contextProviderConfig(value));
  }
});

test('local Runtime transport enforces envelopes, UTF-8 framing and read-only methods', async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.once('data', (data) => {
      const request = JSON.parse(data.toString());
      assert.equal(request.method, 'runtime.describe');
      const response = Buffer.from(JSON.stringify({ protocol: 'nebula.runtime', version: 1,
        id: request.id, ok: true, result: { text: '\u4f60\u597d' } }) + '\n');
      const split = response.indexOf(Buffer.from('\u4f60')) + 1;
      socket.write(response.subarray(0, split));
      setTimeout(() => socket.end(response.subarray(split)), 5);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  const runtime = new PebrelRuntime({ env: { PEBREL_RUNTIME_ENDPOINT: `${server.address().port} ${'a'.repeat(32)}` } });
  assert.deepEqual(await runtime.request('runtime.describe'), { text: '\u4f60\u597d' });
  await assert.rejects(runtime.request('pane.prompt', {}), { code: 'CONTEXT_RUNTIME_INVALID' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runtime.request('pane.read', {}, { signal: controller.signal }), { code: 'CANCELLED' });
});

test('autostart bootstrap uses supported non-TTY environment export and hides the helper', async () => {
  const calls = [];
  const runtime = new PebrelRuntime({ cli: path.resolve('pebrel.exe'), env: {}, run: async (cli, args, options) => {
    calls.push(args);
    assert.equal(options.windowsHide, true);
    if (args[1] === 'describe') return { stdout: JSON.stringify({ ok: true, result: { features: ['pane.exec.non_tty'] } }) };
    if (args[1] === 'snapshot') return { stdout: JSON.stringify({ ok: true, result: snapshot() }) };
    assert.equal(args[1], 'exec-pane');
    assert.ok(args.includes(process.execPath));
    return { stdout: JSON.stringify({ ok: true, result: { exit_code: 0, stdout: `12345 ${'a'.repeat(32)}`,
      capture: { stdout: { truncated: false }, stderr: { truncated: false } } } }) };
  } });
  await runtime.connect();
  assert.equal(runtime.endpoint.port, 12345);
  assert.deepEqual(calls.map((args) => args[1]), ['describe', 'snapshot', 'exec-pane']);
});
