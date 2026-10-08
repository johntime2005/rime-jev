import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest } from '../bridge.mjs';

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
