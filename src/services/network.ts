import { networkInterfaces } from 'node:os';
import type { NetworkInfo } from '../types.js';

function detectLanIp(): string | null {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === 'IPv4' && !ni.internal && ni.address) {
        return ni.address;
      }
    }
  }
  return null;
}

export async function detectNetwork(port: number): Promise<NetworkInfo> {
  const localUrl = `http://localhost:${port}`;
  const lanIp = detectLanIp();

  return {
    lanIp,
    lanUrl: lanIp ? `http://${lanIp}:${port}` : null,
    localUrl,
  };
}
