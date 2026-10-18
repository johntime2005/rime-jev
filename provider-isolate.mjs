import { Worker } from 'node:worker_threads';

const failure = (code) => Object.assign(new Error(code), { code });
export const CANCEL_GRACE_MS = 100;

// Reuse a worker after acknowledged cancellation, but bound even an ignored
// abort independently of its event loop. The single request slot stays held.
export class IsolatedProvider {
  constructor({ provider, apiKey, timeoutMs, workerUrl = new URL('./provider-worker.mjs', import.meta.url) }) {
    this.options = { provider, apiKey, timeoutMs };
    this.workerUrl = workerUrl;
    this.worker = null;
    this.active = false;
    this.closed = false;
    this.sequence = 0;
    this.metrics = { starts: 0, hardTimeouts: 0, cancellations: 0,
      cooperativeCancellations: 0, hardCancellations: 0, failures: 0 };
  }

  warm() {
    if (this.closed || this.worker) return;
    // Loading the worker is local only; this never dispatches an API request.
    this.worker = new Worker(this.workerUrl, { workerData: this.options,
      execArgv: [], stdout: true, stderr: true });
    this.worker.stdout.resume();
    this.worker.stderr.resume();
    const created = this.worker;
    created.on('error', () => {});
    created.once('exit', () => { if (this.worker === created) this.worker = null; });
    this.metrics.starts++;
  }

  async rank(snapshot, context, { signal } = {}) {
    if (this.closed) throw failure('PROVIDER_STOPPED');
    if (this.active) throw failure('BUSY');
    if (signal?.aborted) throw failure('CANCELLED');
    this.active = true;
    let worker, destroy = false;
    try {
      this.warm();
      worker = this.worker;
      const id = ++this.sequence;
      return await new Promise((resolve, reject) => {
        let settled = false, cancelling = false, cancelTimer;
        const finish = (error, result, terminate = false) => {
          if (settled) return;
          settled = true;
          destroy = terminate;
          clearTimeout(timer);
          clearTimeout(cancelTimer);
          signal?.removeEventListener('abort', abort);
          worker.off('message', message);
          worker.off('error', crashed);
          worker.off('exit', exited);
          if (cancelling) {
            this.metrics[terminate ? 'hardCancellations' : 'cooperativeCancellations']++;
            error = failure('CANCELLED'); result = undefined;
          }
          if (error) reject(error); else resolve(result);
        };
        const abort = () => {
          if (settled || cancelling) return;
          cancelling = true;
          this.metrics.cancellations++;
          cancelTimer = setTimeout(() => finish(failure('CANCELLED'), null, true), CANCEL_GRACE_MS);
          try { worker.postMessage({ id, type: 'cancel' }); }
          catch { finish(failure('CANCELLED'), null, true); }
        };
        const crashed = () => {
          this.metrics.failures++;
          finish(failure('PROVIDER_WORKER_FAILED'), null, true);
        };
        const exited = () => crashed();
        const message = (reply) => {
          if (reply?.id !== id) return;
          if (cancelling && (reply.error === 'CANCELLED' || reply.result)) {
            // A completed request can race its abort. Discard that result too;
            // only acknowledgement that the worker is idle permits reuse.
            finish(failure('CANCELLED'));
            return;
          }
          if (reply.error) {
            const code = /^[A-Z0-9_]+$/.test(reply.error) ? reply.error : 'PROVIDER_WORKER_FAILED';
            finish(failure(code), null, true);
          } else if (reply.result) {
            finish(null, reply.result);
          } else crashed();
        };
        const timer = setTimeout(() => {
          if (!cancelling) this.metrics.hardTimeouts++;
          finish(failure('TIMEOUT'), null, true);
        }, this.options.timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        worker.on('message', message);
        worker.once('error', crashed);
        worker.once('exit', exited);
        if (signal?.aborted) { abort(); return; }
        try { worker.postMessage({ id, snapshot, context }); }
        catch { crashed(); }
      });
    } finally {
      // An unacknowledged abort, timeout or error still requires actual exit
      // before the next request; a cooperative abort has already settled.
      try {
        if (destroy && worker) {
          await worker.terminate();
          if (this.worker === worker) this.worker = null;
        }
      } finally { this.active = false; }
    }
  }

  async close() {
    this.closed = true;
    const worker = this.worker;
    if (worker) await worker.terminate();
    this.worker = null;
  }
}
