// Explicit synthetic live probe through the running bridge; never reads typed text or keys.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicWrite } from '../bridge.mjs';

if (!process.argv.includes('--live')) throw new Error('Pass --live to send synthetic requests; --repeat submits the three cases twice.');
const root = path.join(process.env.LOCALAPPDATA, 'RimeJev');
const runtime = path.join(root, 'runtime');
const [protocol, instance, token, mode, heartbeat] = (await fs.readFile(path.join(runtime, 'bridge.info'), 'utf8')).trim().split('\n');
if (protocol !== 'JEVWIN1' || mode !== 'live' || Date.now() / 1000 - Number(heartbeat) > 5) {
  throw new Error('A healthy live bridge is required.');
}
const continuationCases = [
  { context: '\u7528\u8fc7\u8fd9\u4e2a\u5de5\u5177\u4e4b\u540e\u624d\u77e5\u9053\u4ec0\u4e48', expectedWinnerRank: 2 },
  { context: '\u8001\u5e08\u6b63\u5728\u8ba4\u771f\u5730', expectedWinnerRank: 6 },
  { context: '\u8bf7\u628a\u586b\u597d\u7684\u8868\u683c', expectedWinnerRank: 1 },
].map((sample) => ({ ...sample, pinyin: 'jiao', candidates: ['\u4ea4', '\u53eb', '\u89d2', '\u2220', '\u5409\u5965', '\u6559', '\u811a'] }));
const cases = process.argv.includes('--continuation-check') ? continuationCases : process.argv.includes('--context-check') ? [
  { pinyin: 'jingli', context: '\u4ed6\u88ab\u4efb\u547d\u4e3a\u90e8\u95e8', expectedWinnerRank: 4 },
  { pinyin: 'jingli', context: '', expectedWinnerRank: null },
  { pinyin: 'jingli', context: '\u8fd9\u4efd\u5de5\u4f5c\u9700\u8981\u6295\u5165\u5927\u91cf', expectedWinnerRank: 5 },
].map((sample) => ({ ...sample, candidates: ['\u7ecf\u5386', '\u656c\u793c', '\u{1fae1}', '\u7ecf\u7406', '\u7cbe\u529b', '\u51c0\u5229', '\u6676\u7c92'] })) : [
  { pinyin: 'jingli', context: '\u4ed6\u88ab\u4efb\u547d\u4e3a\u516c\u53f8\u7684\u603b', candidates: ['\u7ecf\u5386', '\u7ecf\u7406', '\u7cbe\u529b'] },
  { pinyin: 'shishi', context: '\u8fd9\u9879\u653f\u7b56\u5c06\u4e8e\u660e\u5929\u6b63\u5f0f', candidates: ['\u4e8b\u5b9e', '\u5b9e\u65bd', '\u65f6\u4e8b'] },
  { pinyin: 'quanli', context: '\u6cd5\u5f8b\u4fdd\u969c\u6bcf\u4e2a\u516c\u6c11\u7684\u5408\u6cd5', candidates: ['\u6743\u529b', '\u6743\u5229', '\u5168\u529b'] },
];
if (process.argv.includes('--repeat')) cases.push(...cases.slice());
const session = `probe_${randomBytes(8).toString('hex')}`;
for (const [index, sample] of cases.entries()) {
  const id = `${session}_${index + 1}`;
  const input = path.join(runtime, 'inbox', `${id}.json`);
  const output = path.join(runtime, 'outbox', `${id}.res`);
  const started = performance.now();
  try {
    await atomicWrite(input, JSON.stringify({ protocol: 1, id, session, sequence: index + 1,
      instance, token, createdAt: Math.floor(Date.now() / 1000), pinyin: sample.pinyin,
      caret: sample.pinyin.length, preedit: sample.pinyin, context: sample.context,
      document: { source: 'tsf', quality: 'exact', stamp: `0-0-${index + 1}` },
      candidates: sample.candidates.map((text) => ({ text, start: 0, end: sample.pinyin.length })) }));
    let rows;
    while (performance.now() - started < 6000) {
      try { rows = (await fs.readFile(output, 'utf8')).trim().split('\n'); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const elapsedMs = Math.round(performance.now() - started);
    let metrics;
    for (let i = 0; i < 20; i++) {
      const status = JSON.parse(await fs.readFile(path.join(root, 'status.json'), 'utf8'));
      if (status.lastResult?.requestId === id) { metrics = status.lastResult; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    console.log(JSON.stringify({ case: index + 1, synthetic: true, elapsedMs,
      status: rows?.[3] ?? 'NO_RESULT', orderOrError: rows?.[6],
      expectedWinnerRank: Object.hasOwn(sample, 'expectedWinnerRank') ? sample.expectedWinnerRank : 2,
      changed: rows?.[3] === 'ok' && rows[6].split(',')[0] !== '1',
      contextChars: metrics?.contextChars, ranking: metrics?.ranking,
      source: metrics?.source, cacheAgeMs: metrics?.cacheAgeMs, localMs: metrics?.localMs, transport: metrics?.transport,
      discoveryMs: metrics?.discoveryMs,
      providerMs: metrics?.providerMs, readyMs: metrics?.readyMs, guiTested: false }));
  } finally {
    await fs.rm(input, { force: true });
    await fs.rm(output, { force: true });
  }
}
