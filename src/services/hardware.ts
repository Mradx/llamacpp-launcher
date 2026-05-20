import { execSync } from 'node:child_process';
import { totalmem } from 'node:os';
import type { HardwareInfo } from '../types.js';
import { isMac } from '../utils/platform.js';

// Fraction of unified memory Metal will comfortably keep as a GPU working set.
// Apple's recommendedMaxWorkingSetSize is ~75% on Apple Silicon Macs; querying it
// exactly needs native Metal bindings, so we approximate.
const METAL_WORKING_SET_FRACTION = 0.75;

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

function detectCpuMac(): string {
  return tryExec('sysctl -n machdep.cpu.brand_string') || 'Unknown CPU';
}

function parseVramMb(profile: string): number | null {
  // e.g. "VRAM (Total): 4 GB" or "VRAM (Dynamic, Max): 1536 MB"
  const m = profile.match(/VRAM\s*\([^)]*\):\s*([\d.]+)\s*(MB|GB)/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (isNaN(value)) return null;
  return Math.round(m[2].toUpperCase() === 'GB' ? value * 1024 : value);
}

function detectGpuMac(cpuName: string, ramMb: number): { name: string; vramMb: number; unifiedMemory: boolean } {
  const profile = tryExec('system_profiler SPDisplaysDataType 2>/dev/null');
  const chipMatch = profile?.match(/Chipset Model:\s*(.+)/);
  const chipset = chipMatch ? chipMatch[1].trim() : null;
  const budgetMb = Math.round(ramMb * METAL_WORKING_SET_FRACTION);

  // Apple Silicon: GPU shares system RAM (unified memory), no discrete VRAM.
  if (process.arch === 'arm64') {
    return { name: chipset || cpuName || 'Apple GPU', vramMb: budgetMb, unifiedMemory: true };
  }

  // Intel Mac: best-effort discrete VRAM; otherwise treat as a shared pool.
  const vram = profile ? parseVramMb(profile) : null;
  if (vram && vram > 0) {
    return { name: chipset || 'Unknown GPU', vramMb: vram, unifiedMemory: false };
  }
  return { name: chipset || cpuName || 'Unknown GPU', vramMb: budgetMb, unifiedMemory: true };
}

async function detectHardwareMac(): Promise<HardwareInfo> {
  const cpuName = detectCpuMac();
  const ramMb = Math.floor(totalmem() / (1024 * 1024));
  const gpu = detectGpuMac(cpuName, ramMb);
  return {
    gpuName: gpu.name,
    cpuName,
    vramMb: gpu.vramMb,
    ramMb,
    unifiedMemory: gpu.unifiedMemory,
  };
}

export async function detectHardware(): Promise<HardwareInfo> {
  if (isMac()) {
    return detectHardwareMac();
  }

  const gpu = detectGpu();
  const cpuName = detectCpu();
  const ramMb = detectRam();

  return {
    gpuName: gpu.name,
    cpuName,
    vramMb: gpu.vramMb,
    ramMb,
    unifiedMemory: false,
  };
}
