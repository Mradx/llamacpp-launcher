import test from 'node:test';
import assert from 'node:assert/strict';
import { detectNetwork } from '../dist/services/network.js';

test('does not expose a LAN URL when the server binds to localhost', async () => {
  const network = await detectNetwork(8787, '127.0.0.1');

  assert.equal(network.localUrl, 'http://localhost:8787');
  assert.equal(network.lanIp, null);
  assert.equal(network.lanUrl, null);
});

test('does not expose a LAN URL when the server binds to IPv6 localhost', async () => {
  const network = await detectNetwork(8787, '::1');

  assert.equal(network.localUrl, 'http://localhost:8787');
  assert.equal(network.lanIp, null);
  assert.equal(network.lanUrl, null);
});
