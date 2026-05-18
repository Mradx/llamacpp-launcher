import { execSync } from 'node:child_process';
import type { HardwareInfo } from '../types.js';

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000, windowsHide: true }).trim();
  } catch {
    return null;
  }
}

function detectGpu(): { name: string; vramMb: number } {
  const locations = [
    'nvidia-smi',
    `${process.env.SystemRoot ?? 'C:\\WINDOWS'}\\System32\\nvidia-smi.exe`,
    `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`,
  ];

  for (const smi of locations) {
    const result = tryExec(`"${smi}" --query-gpu=name,memory.total --format=csv,noheader,nounits`);
    if (result) {
      const [name, vram] = result.split(',').map(s => s.trim());
      return { name: name || 'Unknown GPU', vramMb: parseInt(vram, 10) || 0 };
    }
  }

  const wmic = tryExec('wmic path win32_VideoController get Name,AdapterRAM /format:csv');
  if (wmic) {
    const lines = wmic.split('\n').filter(l => l.trim() && !l.startsWith('Node'));
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 3) {
        const adapterRam = parseInt(parts[1], 10);
        const name = parts[2]?.trim();
        if (name && !name.toLowerCase().includes('microsoft')) {
          return { name, vramMb: Math.floor(adapterRam / (1024 * 1024)) };
        }
      }
    }
  }

  return { name: 'Unknown GPU', vramMb: 0 };
}

function detectCpu(): string {
  const result = tryExec(
    'reg query "HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0" /v ProcessorNameString'
  );
  if (result) {
    const match = result.match(/ProcessorNameString\s+REG_SZ\s+(.+)/);
    if (match) return match[1].trim();
  }
  return 'Unknown CPU';
}

function detectRam(): number {
  const result = tryExec(
    'powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"'
  );
  if (result) {
    const bytes = parseInt(result, 10);
    if (!isNaN(bytes)) return Math.floor(bytes / (1024 * 1024));
  }
  return 0;
}

export async function detectHardware(): Promise<HardwareInfo> {
  const gpu = detectGpu();
  const cpuName = detectCpu();
  const ramMb = detectRam();

  return {
    gpuName: gpu.name,
    cpuName,
    vramMb: gpu.vramMb,
    ramMb,
  };
}
