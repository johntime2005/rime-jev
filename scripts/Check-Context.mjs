import { promises as fs } from 'node:fs';
import path from 'node:path';
import { contextProviderConfig, PebrelContextReader } from '../context-pebrel.mjs';

// Read-only diagnostic: no provider, IPC publication, typing, or text logging.
const root = path.join(process.env.LOCALAPPDATA ?? '', 'RimeJev');
const config = JSON.parse((await fs.readFile(path.join(root, 'config.json'), 'utf8')).replace(/^\uFEFF/, ''));
const provider = contextProviderConfig(config.contextProvider);
if (!provider) {
  console.log(JSON.stringify({ ok: false, code: 'CONTEXT_NOT_CONFIGURED' }));
  process.exitCode = 1;
} else {
  const preferences = await fs.readFile(path.join(root, 'runtime', 'preferences'), 'utf8');
  if (!/^JEVPREF1\n[01]\n1\n$/.test(preferences)) {
    console.log(JSON.stringify({ ok: false, code: 'CONTEXT_DISABLED' }));
    process.exitCode = 1;
  } else {
    const reader = new PebrelContextReader({ cli: provider.cli });
    const started = performance.now();
    try {
      const captured = await reader.capture({ signal: AbortSignal.timeout(4000) });
      const captureMs = Math.round(performance.now() - started);
      await reader.verify(captured, { signal: AbortSignal.timeout(4000) });
      console.log(JSON.stringify({ ok: true, source: 'pebrel_codex', contextChars: [...captured.text].length,
        captureMs, totalMs: Math.round(performance.now() - started), verified: true, networkProviderCalls: 0 }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, code: /^CONTEXT_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'CONTEXT_UNAVAILABLE',
        totalMs: Math.round(performance.now() - started), networkProviderCalls: 0 }));
      process.exitCode = 1;
    }
  }
}
