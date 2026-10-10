import { readFileSync } from 'node:fs';
import { ProviderTransport } from '../../provider-transport.mjs';

const ca = readFileSync(new URL('./localhost-cert.pem', import.meta.url));
const connection = ProviderTransport.prototype.connection;
ProviderTransport.prototype.connection = function (signal) {
  if (this.url.hostname !== '127.0.0.1') throw new Error('Local fixture only');
  this.ca = ca;
  return connection.call(this, signal);
};
await import('../../provider-worker.mjs');
