import { networkInterfaces } from 'node:os';
import type { NetworkInfo } from '../types.js';

function isLanHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized !== '127.0.0.1' && normalized !== 'localhost' && normalized !== '::1';
}

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

export async function detectNetwork(port: number, host: string): Promise<NetworkInfo> {
  const localUrl = `http://localhost:${port}`;

  if (!isLanHost(host)) {
    return {
      lanIp: null,
      lanUrl: null,
      localUrl,
    };
  }

  const lanIp = detectLanIp();

  return {
    lanIp,
    lanUrl: lanIp ? `http://${lanIp}:${port}` : null,
    localUrl,
  };
}
