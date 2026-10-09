import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest } from '../bridge.mjs';
import { startBridge, atomicWrite } from '../bridge.mjs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const request = () => ({ protocol: 1, id: 'x', session: 'x', sequence: 1,
  instance: 'i', token: 't', createdAt: Math.floor(Date.now() / 1000),
  pinyin: 'ni', caret: 2, preedit: 'ni', context: 'word  \nnext',
  document: { source: 'tsf', quality: 'exact', stamp: '1-2-3' },
  candidates: ['one', 'two'].map(text => ({ text, start: 0, end: 2 })) });

test('only explicit exact TSF snapshots can supply text; no legacy history fallback', () => {
  const r = request();
  assert.doesNotThrow(() => validateRequest(r, 'i', 't'));
  for (const document of [undefined, null, {}, { ...r.document, source: 'screen' },
    { ...r.document, quality: 'partial' }, { ...r.document, quality: 'unavailable' },
    { ...r.document, quality: 'pending' }, { ...r.document, quality: 'sensitive' },
    { ...r.document, stamp: '' }, { ...r.document, stamp: '1\n2' }]) {
    assert.throws(() => validateRequest({ ...r, document }, 'i', 't'));
  }
  assert.doesNotThrow(() => validateRequest({ ...r, context: '', document: undefined }, 'i', 't'));
  assert.doesNotThrow(() => validateRequest({ ...r, context: '', document: {
    source: 'tsf', quality: 'unavailable', stamp: '' } }, 'i', 't'));
});

test('Unicode scalar bound, real whitespace, and unsafe or malformed text', () => {
  const r = request();
  for (const context of ['', '\u{1f600}'.repeat(80), 'a  \r\nb\t', 'e\u0301', '\u05d0\u05d1'])
    assert.doesNotThrow(() => validateRequest({ ...r, context }, 'i', 't'));
  for (const context of ['a'.repeat(81), '\u{1f600}'.repeat(81), '\ud800', '\udfff', '\0', '\x1b', '\ufffc'])
    assert.throws(() => validateRequest({ ...r, context }, 'i', 't'));
});

test('mixed-version empty-context requests retain the v1 response protocol', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-v1-compat-'));
  const bridge = await startBridge({ root, mock: true, debounceMs: 0 });
  try {
    const r = { ...request(), instance: bridge.instance, token: bridge.token, context: '' };
    delete r.document;
    await atomicWrite(path.join(bridge.runtime, 'inbox', 'x.json'), JSON.stringify(r));
    let output;
    for (let i = 0; i < 60; ++i) {
      try { output = await fs.readFile(path.join(bridge.runtime, 'outbox', 'x.res'), 'utf8'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 30)); }
    }
    assert.match(output, /^JEVWIN1\n/);
    assert.equal(output.trimEnd().split('\n').length, 7);
  } finally { await bridge.stop(); }
});
