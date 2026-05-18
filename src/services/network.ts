import { execSync } from 'node:child_process';
import type { NetworkInfo } from '../types.js';

export async function detectNetwork(port: number): Promise<NetworkInfo> {
  const localUrl = `http://localhost:${port}`;
  let lanIp: string | null = null;

  try {
    const result = execSync(
      'powershell -NoProfile -Command "$c=New-Object Net.Sockets.UdpClient;$c.Connect(\'8.8.8.8\',80);($c.Client.LocalEndPoint).Address.ToString();$c.Close()"',
      { encoding: 'utf-8', timeout: 5000, windowsHide: true }
    ).trim();

    if (result && result.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      lanIp = result;
    }
  } catch {
    // network detection failed
  }

  return {
    lanIp,
    lanUrl: lanIp ? `http://${lanIp}:${port}` : null,
    localUrl,
  };
}
