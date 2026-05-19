import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir, availableParallelism } from 'node:os';
import type { SpawnOptions } from 'node:child_process';

// ── Types ──

export interface PrerequisiteStatus {
  git: { found: boolean; version: string | null };
  cmake: { found: boolean; path: string | null; vsEdition: string | null };
  cuda: { found: boolean; path: string | null; version: string | null; allVersions: string[] };
  node: { found: boolean; version: string | null; nvmFound: boolean; supported: boolean };
  gpu: { name: string | null; arch: number | null };
  cpuCores: number;
}

export type InstallPhase =
  | 'clone'
  | 'build-ui'
  | 'cmake-configure'
  | 'cmake-build'
  | 'done'
  | 'error';

export interface InstallProgress {
  phase: InstallPhase;
  message: string;
  detail?: string;
  percent?: number;
  subPhase?: string;
  elapsed?: number;
  stalled?: boolean;
}

export type ProgressCallback = (progress: InstallProgress) => void;

// ── GPU arch fallback map ──

const GPU_ARCH_MAP: Record<string, number> = {
  '5090': 120, '5080': 120, '5070': 120, '5060': 120,
  '4090': 89,  '4080': 89,  '4070': 89,  '4060': 89,
  '3090': 86,  '3080': 86,  '3070': 86,  '3060': 86,
  '2080': 75,  '2070': 75,  '2060': 75,
};

export const NODE_WEB_UI_REQUIREMENT = '20.19+, 22.13+, or 24+';

// ── Helpers ──

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: 15000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function prependPath(dir: string): void {
  const parts = (process.env.PATH || '').split(';').filter(Boolean);
  if (!parts.some(part => part.toLowerCase() === dir.toLowerCase())) {
    process.env.PATH = `${dir};${process.env.PATH || ''}`;
  }
}

function appendPath(dir: string): void {
  const parts = (process.env.PATH || '').split(';').filter(Boolean);
  if (!parts.some(part => part.toLowerCase() === dir.toLowerCase())) {
    process.env.PATH = `${process.env.PATH || ''};${dir}`;
  }
}

function refreshProcessPath(): void {
  const envPath = tryExec(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$m=[Environment]::GetEnvironmentVariable('Path','Machine'); $u=[Environment]::GetEnvironmentVariable('Path','User'); [Console]::Out.Write($m+';'+$u)"`,
  );
  if (envPath) {
    process.env.PATH = `${process.env.PATH || ''};${envPath}`;
  }

  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;

  for (const dir of [
    join(programFiles, 'nodejs'),
    join(programFiles, 'Git', 'cmd'),
    programFilesX86 ? join(programFilesX86, 'nodejs') : null,
    programFilesX86 ? join(programFilesX86, 'Git', 'cmd') : null,
    localAppData ? join(localAppData, 'Programs', 'nodejs') : null,
    localAppData ? join(localAppData, 'Programs', 'Git', 'cmd') : null,
  ]) {
    if (dir && existsSync(dir)) appendPath(dir);
  }
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function spawnWithProgress(
  cmd: string,
  args: string[],
  opts: SpawnOptions,
  onLine: (line: string, stream: 'stdout' | 'stderr') => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      ...opts,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const errorLines: string[] = [];

    const handleData = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          onLine(trimmed, stream);
          if (stream === 'stderr') {
            errorLines.push(trimmed);
            if (errorLines.length > 30) errorLines.shift();
          }
        }
      }
    };

    proc.stdout?.on('data', handleData('stdout'));
    proc.stderr?.on('data', handleData('stderr'));

    proc.on('error', (err) => reject(new Error(`Failed to start: ${err.message}`)));
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const tail = errorLines.slice(-15).join('\n');
        reject(new Error(`Exit code ${code}\n${tail}`));
      }
    });
  });
}

// ── Prerequisite Detection ──

function detectGit(): PrerequisiteStatus['git'] {
  refreshProcessPath();

  let raw = tryExec('git --version');
  if (!raw) {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    const localAppData = process.env.LOCALAPPDATA;
    const candidates = [
      join(programFiles, 'Git', 'cmd', 'git.exe'),
      programFilesX86 ? join(programFilesX86, 'Git', 'cmd', 'git.exe') : null,
      localAppData ? join(localAppData, 'Programs', 'Git', 'cmd', 'git.exe') : null,
    ];

    for (const candidate of candidates) {
      if (!candidate || !existsSync(candidate)) continue;
      raw = tryExec(`"${candidate}" --version`);
      if (raw) {
        prependPath(dirname(candidate));
        break;
      }
    }
  }

  if (!raw) return { found: false, version: null };
  const match = raw.match(/(\d+\.\d+[\.\d]*)/);
  return { found: true, version: match ? match[1] : raw };
}

function detectVsCmake(): PrerequisiteStatus['cmake'] {
  const editions = ['BuildTools', 'Community', 'Professional', 'Enterprise'];
  const vsBase = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022';
  const cmakeSuffix = 'Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe';

  for (const edition of editions) {
    const cmakePath = join(vsBase, edition, cmakeSuffix);
    if (existsSync(cmakePath)) {
      return { found: true, path: cmakePath, vsEdition: edition };
    }
  }
  return { found: false, path: null, vsEdition: null };
}

interface MsvcToolset {
  version: string;
  binDir: string;
}

function getVsRootFromCmake(cmakePath: string): string | null {
  const normalized = cmakePath.replace(/\//g, '\\');
  const marker = '\\Common7\\';
  const idx = normalized.toLowerCase().indexOf(marker.toLowerCase());
  return idx > 0 ? normalized.slice(0, idx) : null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  const max = Math.max(pa.length, pb.length);
  for (let i = 0; i < max; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function parseNodeVersion(version: string | null): [number, number, number] | null {
  const match = version?.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [
    parseInt(match[1], 10),
    parseInt(match[2], 10),
    parseInt(match[3], 10),
  ];
}

function isWebUiNodeSupportedVersion(version: string | null): boolean {
  const parsed = parseNodeVersion(version);
  if (!parsed) return false;

  const [major, minor] = parsed;
  return (major === 20 && minor >= 19)
    || (major === 22 && minor >= 13)
    || major >= 24;
}

function findMsvcToolset(cmakePath: string, preferCudaCompatible: boolean): MsvcToolset | null {
  const vsRoot = getVsRootFromCmake(cmakePath);
  if (!vsRoot) return null;

  const msvcRoot = join(vsRoot, 'VC', 'Tools', 'MSVC');
  if (!existsSync(msvcRoot)) return null;

  let toolsets: MsvcToolset[] = [];
  try {
    toolsets = readdirSync(msvcRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({
        version: d.name,
        binDir: join(msvcRoot, d.name, 'bin', 'Hostx64', 'x64'),
      }))
      .filter(t => existsSync(join(t.binDir, 'cl.exe')))
      .sort((a, b) => compareVersions(b.version, a.version));
  } catch {
    return null;
  }

  if (toolsets.length === 0) return null;

  if (preferCudaCompatible) {
    const cudaFriendly = toolsets.find(t => compareVersions(t.version, '14.43') <= 0);
    if (cudaFriendly) return cudaFriendly;
  }

  return toolsets[0];
}

function getVsToolsetArg(prereqs: PrerequisiteStatus, msvcToolset: MsvcToolset | null): string {
  const parts = ['host=x64'];

  if (prereqs.cuda.found && prereqs.cuda.version) {
    parts.push(`cuda=${prereqs.cuda.version}`);
  }

  if (msvcToolset) {
    parts.push(`version=${msvcToolset.version}`);
  }

  return parts.join(',');
}

function buildCmakeEnv(prereqs: PrerequisiteStatus, msvcToolset: MsvcToolset | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, VSLANG: '1033' };
  if (msvcToolset) {
    env.PATH = `${msvcToolset.binDir};${env.PATH || ''}`;
    env.CUDAHOSTCXX = join(msvcToolset.binDir, 'cl.exe');
  }
  if (prereqs.cuda.path) {
    env.CUDAToolkit_ROOT = prereqs.cuda.path;
    env.CUDA_PATH = prereqs.cuda.path;
  }
  return env;
}

function detectCuda(): PrerequisiteStatus['cuda'] {
  const cudaBase = 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA';
  const allVersions: string[] = [];

  if (existsSync(cudaBase)) {
    try {
      const dirs = readdirSync(cudaBase, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith('v')) {
          const nvcc = join(cudaBase, d.name, 'bin', 'nvcc.exe');
          if (existsSync(nvcc)) {
            allVersions.push(d.name.slice(1)); // strip 'v' prefix
          }
        }
      }
    } catch { /* ignore */ }
  }

  if (allVersions.length === 0) {
    return { found: false, path: null, version: null, allVersions: [] };
  }

  // prefer 12.8, otherwise highest
  const preferred = allVersions.find(v => v === '12.8')
    || allVersions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];

  return {
    found: true,
    path: join(cudaBase, `v${preferred}`),
    version: preferred,
    allVersions,
  };
}

function detectNode(): PrerequisiteStatus['node'] {
  refreshProcessPath();

  const nvmVersion = tryExec('nvm version');
  const nvmFound = nvmVersion !== null && nvmVersion !== '' && nvmVersion !== 'No current version'
    || Boolean(process.env.NVM_HOME || process.env.NVM_SYMLINK)
    || /\\nvm(4w)?\\/i.test(process.execPath);
  let nodeVersion = process.execPath.toLowerCase().endsWith('node.exe')
    ? tryExec(`"${process.execPath}" --version`)
    : null;

  if (!nodeVersion) {
    nodeVersion = tryExec('node --version');
  }

  if (!nodeVersion) {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    const localAppData = process.env.LOCALAPPDATA;
    const appData = process.env.APPDATA;
    const candidates = [
      process.env.NVM_SYMLINK ? join(process.env.NVM_SYMLINK, 'node.exe') : null,
      join(programFiles, 'nodejs', 'node.exe'),
      programFilesX86 ? join(programFilesX86, 'nodejs', 'node.exe') : null,
      localAppData ? join(localAppData, 'Programs', 'nodejs', 'node.exe') : null,
      localAppData ? join(localAppData, 'Volta', 'bin', 'node.exe') : null,
    ];

    for (const candidate of candidates) {
      if (!candidate || !existsSync(candidate)) continue;
      nodeVersion = tryExec(`"${candidate}" --version`);
      if (nodeVersion) {
        prependPath(dirname(candidate));
        break;
      }
    }

    const nvmRoots = [
      process.env.NVM_HOME,
      appData ? join(appData, 'nvm') : null,
      localAppData ? join(localAppData, 'nvm') : null,
    ];

    for (const root of nvmRoots) {
      if (nodeVersion || !root || !existsSync(root)) continue;
      try {
        const dirs = readdirSync(root, { withFileTypes: true })
          .filter(d => d.isDirectory() && /^v\d+\.\d+\.\d+$/i.test(d.name))
          .map(d => d.name)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

        for (const dir of dirs) {
          const candidate = join(root, dir, 'node.exe');
          if (!existsSync(candidate)) continue;
          nodeVersion = tryExec(`"${candidate}" --version`);
          if (nodeVersion) {
            prependPath(dirname(candidate));
            break;
          }
        }
      } catch {
        // ignore unreadable NVM folders
      }
    }
  }

  const version = nodeVersion?.replace(/^v/, '') || null;
  return {
    found: version !== null,
    version,
    nvmFound,
    supported: isWebUiNodeSupportedVersion(version),
  };
}

function detectGpuArch(): PrerequisiteStatus['gpu'] {
  const smiLocations = [
    'nvidia-smi',
    `${process.env.SystemRoot ?? 'C:\\WINDOWS'}\\System32\\nvidia-smi.exe`,
    `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`,
  ];

  for (const smi of smiLocations) {
    const raw = tryExec(`"${smi}" --query-gpu=name,compute_cap --format=csv,noheader,nounits`);
    if (raw) {
      const [name, cap] = raw.split(',').map(s => s.trim());
      if (cap) {
        const arch = Math.round(parseFloat(cap) * 10);
        if (!isNaN(arch)) {
          return { name: name || null, arch };
        }
      }
      // fallback: try name-based lookup
      if (name) {
        for (const [key, arch] of Object.entries(GPU_ARCH_MAP)) {
          if (name.includes(key)) return { name, arch };
        }
        return { name, arch: null };
      }
    }
  }

  // try name-only query
  for (const smi of smiLocations) {
    const raw = tryExec(`"${smi}" --query-gpu=name --format=csv,noheader`);
    if (raw) {
      const name = raw.trim();
      for (const [key, arch] of Object.entries(GPU_ARCH_MAP)) {
        if (name.includes(key)) return { name, arch };
      }
      return { name, arch: null };
    }
  }

  return { name: null, arch: null };
}

export function detectPrerequisites(): PrerequisiteStatus {
  return {
    git: detectGit(),
    cmake: detectVsCmake(),
    cuda: detectCuda(),
    node: detectNode(),
    gpu: detectGpuArch(),
    cpuCores: availableParallelism(),
  };
}

export function getCriticalMissing(status: PrerequisiteStatus): string[] {
  const missing: string[] = [];
  if (!status.git.found) missing.push('Git');
  if (!status.cmake.found) missing.push('Visual Studio 2022');
  return missing;
}

export function getOptionalMissing(status: PrerequisiteStatus): string[] {
  const missing: string[] = [];
  if (!status.cuda.found) missing.push('CUDA Toolkit');
  if (!status.gpu.name) missing.push('NVIDIA GPU');
  if (!status.node.found || !status.node.supported) missing.push('Node.js');
  return missing;
}

export function canAutoInstall(name: string): boolean {
  return name === 'Git' || name === 'Node.js' || name === 'Visual Studio 2022';
}

// ── Network connectivity check ──

async function checkNetwork(): Promise<boolean> {
  try {
    await fetch('https://www.msftconnecttest.com/connecttest.txt', {
      signal: AbortSignal.timeout(5000),
    });
    return true;
  } catch {
    return false;
  }
}

// ── Install progress tracker ──

interface StallDetectionOptions {
  checkNetwork?: boolean;
  idleDetail?: (silentSec: number) => string;
  failedConnectivityDetail?: (attempts: number) => string;
  restoredDetail?: string;
  stalled?: boolean;
}

class InstallTracker {
  private startTime = Date.now();
  private lastActivityTime = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentDetail = '';

  constructor(
    private onProgress: ProgressCallback,
    private phase: InstallPhase,
    private subPhase: string,
  ) {}

  get elapsed(): number {
    return Math.round((Date.now() - this.startTime) / 1000);
  }

  setSubPhase(sp: string): void {
    this.subPhase = sp;
    this.lastActivityTime = Date.now();
    this.currentDetail = '';
  }

  report(message: string, detail?: string, percent?: number): void {
    this.lastActivityTime = Date.now();
    if (detail) this.currentDetail = detail;
    this.onProgress({
      phase: this.phase,
      subPhase: this.subPhase,
      message,
      detail,
      percent,
      elapsed: this.elapsed,
      stalled: false,
    });
  }

  startStallDetection(thresholdSec: number = 45, options: StallDetectionOptions = {}): void {
    this.stopStallDetection();
    const checkNetworkEnabled = options.checkNetwork ?? true;
    const stalled = options.stalled ?? true;
    const idleDetail = options.idleDetail
      ?? ((silentSec: number) => `No output for ${silentSec}s - process still running`);
    const failedConnectivityDetail = options.failedConnectivityDetail
      ?? ((attempts: number) => `Connectivity check failed - process may still be running (attempt ${attempts})`);
    const restoredDetail = options.restoredDetail
      ?? 'Connectivity check restored - waiting for process to resume...';
    let networkLost = false;
    let reconnectAttempts = 0;
    let checking = false;

    this.timer = setInterval(async () => {
      if (checking) return;

      const silentSec = Math.round((Date.now() - this.lastActivityTime) / 1000);
      if (silentSec >= thresholdSec) {
        if (checkNetworkEnabled) {
          checking = true;
          const online = await checkNetwork();
          checking = false;

          if (!online) {
            networkLost = true;
            reconnectAttempts++;
            this.onProgress({
              phase: this.phase,
              subPhase: this.subPhase,
              message: this.subPhase,
              detail: failedConnectivityDetail(reconnectAttempts),
              elapsed: this.elapsed,
              stalled: true,
            });
            return;
          }

          if (networkLost) {
            networkLost = false;
            reconnectAttempts = 0;
            this.onProgress({
              phase: this.phase,
              subPhase: this.subPhase,
              message: this.subPhase,
              detail: restoredDetail,
              elapsed: this.elapsed,
              stalled: false,
            });
            return;
          }
        } else {
          networkLost = false;
          reconnectAttempts = 0;
        }

        this.onProgress({
          phase: this.phase,
          subPhase: this.subPhase,
          message: this.subPhase,
          detail: idleDetail(silentSec),
          elapsed: this.elapsed,
          stalled,
        });
      } else {
        networkLost = false;
        reconnectAttempts = 0;
        this.onProgress({
          phase: this.phase,
          subPhase: this.subPhase,
          message: this.subPhase,
          detail: this.currentDetail,
          elapsed: this.elapsed,
          stalled: false,
        });
      }
    }, 3000);
  }

  stopStallDetection(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  stop(): void {
    this.stopStallDetection();
  }
}

// ── Auto-install helpers ──

async function installViaWinget(
  wingetId: string,
  displayName: string,
  onProgress: ProgressCallback,
): Promise<{ ok: boolean; error?: string }> {
  const wingetCheck = tryExec('winget --version');
  if (!wingetCheck) {
    return installDirectPackage(wingetId, displayName, onProgress);
  }

  const phase: InstallPhase = 'clone';
  const tracker = new InstallTracker(onProgress, phase, 'Preparing');
  tracker.report(`Installing ${displayName} via winget...`);
  tracker.startStallDetection(45);

  try {
    await spawnWithProgress(
      'winget',
      ['install', '--id', wingetId, '-e', '--accept-source-agreements', '--accept-package-agreements'],
      { shell: true },
      (line) => {
        if (/^Found\b/i.test(line)) {
          tracker.setSubPhase('Found package');
        } else if (/download/i.test(line)) {
          tracker.setSubPhase('Downloading');
        } else if (/install/i.test(line)) {
          tracker.setSubPhase('Installing');
        } else if (/successfully/i.test(line)) {
          tracker.setSubPhase('Complete');
        }

        let percent: number | undefined;
        const pctMatch = line.match(/([\d.]+)\s*%/);
        if (pctMatch) percent = Math.round(parseFloat(pctMatch[1]));

        tracker.report(`Installing ${displayName}...`, line, percent);
      },
    );
    tracker.stop();
    refreshProcessPath();
    return { ok: true };
  } catch (err) {
    tracker.stop();
    const fallback = await installDirectPackage(wingetId, displayName, onProgress);
    if (fallback.ok) return fallback;

    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to install ${displayName}: ${msg}\n${fallback.error || ''}`.trim() };
  }
}

async function installDirectPackage(
  wingetId: string,
  displayName: string,
  onProgress: ProgressCallback,
): Promise<{ ok: boolean; error?: string }> {
  if (wingetId === 'OpenJS.NodeJS.LTS') {
    return installNodeDirect(onProgress);
  }

  if (wingetId === 'Git.Git') {
    return installGitDirect(onProgress);
  }

  return { ok: false, error: `winget not found and no direct installer fallback is available for ${displayName}.` };
}

async function installNodeDirect(onProgress: ProgressCallback): Promise<{ ok: boolean; error?: string }> {
  const installerPath = join(tmpdir(), `llamacpp-node-lts-${Date.now()}.msi`);
  const tracker = new InstallTracker(onProgress, 'clone', 'Downloading Node.js');
  tracker.report('Downloading Node.js LTS MSI...');
  tracker.startStallDetection(30);

  try {
    await spawnWithProgress(
      'powershell',
      [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `$ErrorActionPreference='Stop'; ` +
        `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; ` +
        `$data=Invoke-RestMethod 'https://nodejs.org/dist/index.json' -TimeoutSec 20; ` +
        `$v=$data | Where-Object { $_.lts -ne $false -and $_.files -contains 'win-x64-msi' } | Select-Object -First 1; ` +
        `if(-not $v){ throw 'No Node.js LTS MSI found' }; ` +
        `$version=$v.version.TrimStart('v'); ` +
        `$url='https://nodejs.org/dist/'+$v.version+'/node-v'+$version+'-x64.msi'; ` +
        `Invoke-WebRequest -Uri $url -OutFile ${psQuote(installerPath)} -UseBasicParsing; ` +
        `Write-Output ('Downloaded Node.js ' + $version)`,
      ],
      {},
      line => tracker.report('Downloading Node.js LTS MSI...', line),
    );

    tracker.setSubPhase('Installing Node.js');
    tracker.report('Installing Node.js LTS...');
    await spawnWithProgress(
      'msiexec',
      ['/i', installerPath, '/passive', '/norestart'],
      {},
      line => tracker.report('Installing Node.js LTS...', line),
    );
  } catch (err) {
    tracker.stop();
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('Exit code 3010')) {
      return { ok: false, error: `Node.js direct installer failed: ${msg}` };
    }
  }

  tracker.stop();
  refreshProcessPath();
  return { ok: true };
}

async function installGitDirect(onProgress: ProgressCallback): Promise<{ ok: boolean; error?: string }> {
  const installerPath = join(tmpdir(), `llamacpp-git-${Date.now()}.exe`);
  const tracker = new InstallTracker(onProgress, 'clone', 'Downloading Git');
  tracker.report('Downloading Git for Windows installer...');
  tracker.startStallDetection(30);

  try {
    await spawnWithProgress(
      'powershell',
      [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `$ErrorActionPreference='Stop'; ` +
        `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; ` +
        `$release=Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest' -TimeoutSec 20; ` +
        `$asset=$release.assets | Where-Object { $_.name -match '^Git-\\d+(\\.\\d+)+-64-bit\\.exe$' } | Select-Object -First 1; ` +
        `if(-not $asset){ throw 'Git 64-bit installer asset not found' }; ` +
        `Invoke-WebRequest -Uri $asset.browser_download_url -OutFile ${psQuote(installerPath)} -UseBasicParsing; ` +
        `Write-Output ('Downloaded ' + $asset.name)`,
      ],
      {},
      line => tracker.report('Downloading Git for Windows installer...', line),
    );

    tracker.setSubPhase('Installing Git');
    tracker.report('Installing Git for Windows...');
    await spawnWithProgress(
      installerPath,
      [
        '/VERYSILENT',
        '/NORESTART',
        '/NOCANCEL',
        '/SP-',
        '/CLOSEAPPLICATIONS',
        '/RESTARTAPPLICATIONS',
        '/o:PathOption=Cmd',
      ],
      {},
      line => tracker.report('Installing Git for Windows...', line),
    );
  } catch (err) {
    tracker.stop();
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Git direct installer failed: ${msg}` };
  }

  tracker.stop();
  refreshProcessPath();
  return { ok: true };
}

const VS_BUILDTOOLS_URL = 'https://aka.ms/vs/17/release/vs_BuildTools.exe';

async function installVsBuildTools(onProgress: ProgressCallback): Promise<{ ok: boolean; error?: string }> {
  const phase: InstallPhase = 'clone';
  const installerPath = join(tmpdir(), 'vs_BuildTools.exe');

  const tracker = new InstallTracker(onProgress, phase, 'Downloading installer');
  tracker.report('Downloading VS Build Tools installer...');
  tracker.startStallDetection(30);

  try {
    await spawnWithProgress(
      'powershell',
      [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ` +
        `Invoke-WebRequest -Uri '${VS_BUILDTOOLS_URL}' -OutFile '${installerPath}' -UseBasicParsing`,
      ],
      {},
      (line) => {
        tracker.report('Downloading VS Build Tools...', line);
      },
    );
  } catch (err) {
    tracker.stop();
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Download failed: ${msg}` };
  }

  tracker.setSubPhase('Installing C++ build tools');
  tracker.report('Installing C++ workload — this may take 5-15 minutes');
  tracker.startStallDetection(60, {
    checkNetwork: false,
    idleDetail: (silentSec) => `Visual Studio Installer is still working (${silentSec}s without console output)`,
    stalled: false,
  });

  try {
    await spawnWithProgress(
      installerPath,
      [
        '--add', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '--add', 'Microsoft.VisualStudio.Component.VC.CMake.Project',
        '--add', 'Microsoft.VisualStudio.Component.Windows11SDK.26100',
        '--passive',
        '--norestart',
        '--wait',
      ],
      {},
      (line) => {
        tracker.report('Installing C++ build tools...', line);
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('Exit code 3010')) {
      tracker.stop();
      return { ok: false, error: `VS Build Tools installation failed: ${msg}` };
    }
  }

  // The bootstrapper may exit before the VS Installer finishes.
  // Poll for the installed CMake executable instead of trusting process names:
  // Visual Studio Installer can move work into GUI/helper processes that do not
  // show up as setup.exe.
  if (!detectVsCmake().found) {
    tracker.setSubPhase('Waiting for VS Installer');
    tracker.report('VS Installer is still working...');
    tracker.startStallDetection(30, {
      checkNetwork: false,
      idleDetail: (silentSec) => `Waiting for VS Installer to finish (${silentSec}s without console output)`,
      stalled: false,
    });

    const maxWaitMs = 30 * 60 * 1000;
    const pollMs = 5000;
    const waitStart = Date.now();

    while (Date.now() - waitStart < maxWaitMs) {
      if (detectVsCmake().found) break;

      const waitSec = Math.round((Date.now() - waitStart) / 1000);
      tracker.report(
        'VS Installer is still working...',
        `Waiting for CMake tools to appear... (${waitSec}s)`,
      );
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  }

  tracker.stop();

  if (detectVsCmake().found) {
    return { ok: true };
  }

  return { ok: false, error: 'VS Build Tools installation did not complete. Check the VS Installer or install manually.' };
}

export async function autoInstallPrereq(
  name: 'Git' | 'Node.js' | 'Visual Studio 2022',
  onProgress: ProgressCallback,
): Promise<{ ok: boolean; error?: string }> {
  if (name === 'Git') {
    return installViaWinget('Git.Git', 'Git', onProgress);
  }

  if (name === 'Node.js') {
    return installViaWinget('OpenJS.NodeJS.LTS', 'Node.js LTS', onProgress);
  }

  if (name === 'Visual Studio 2022') {
    return installVsBuildTools(onProgress);
  }

  return { ok: false, error: `Unsupported prerequisite: ${name}` };
}

// ── Installation Functions ──

export async function cloneRepo(
  targetDir: string,
  onProgress: ProgressCallback,
): Promise<void> {
  if (existsSync(join(targetDir, '.git'))) {
    onProgress({ phase: 'clone', message: 'Repository already exists, skipping clone' });
    return;
  }

  mkdirSync(dirname(targetDir), { recursive: true });
  onProgress({ phase: 'clone', message: 'Cloning llama.cpp repository...' });

  await spawnWithProgress(
    'git',
    ['clone', '--progress', 'https://github.com/ggml-org/llama.cpp.git', targetDir],
    {},
    (line) => {
      let percent: number | undefined;
      const match = line.match(/(\d+)%/);
      if (match) percent = parseInt(match[1], 10);
      onProgress({ phase: 'clone', message: 'Cloning...', detail: line, percent });
    },
  );
}

export async function buildWebUI(
  llamaCppDir: string,
  onProgress: ProgressCallback,
): Promise<void> {
  const uiDir = join(llamaCppDir, 'tools', 'ui');

  if (!existsSync(uiDir)) {
    onProgress({ phase: 'build-ui', message: 'Web UI directory not found, skipping' });
    return;
  }

  if (process.execPath.toLowerCase().endsWith('node.exe')) {
    prependPath(dirname(process.execPath));
  }

  const nodeCheck = process.execPath.toLowerCase().endsWith('node.exe')
    ? tryExec(`"${process.execPath}" --version`)
    : tryExec('node --version');
  if (!nodeCheck) {
    onProgress({ phase: 'build-ui', message: 'Node.js not found, skipping web UI build' });
    return;
  }

  const nodeVersion = nodeCheck.replace(/^v/, '');
  if (!isWebUiNodeSupportedVersion(nodeVersion)) {
    onProgress({
      phase: 'build-ui',
      message: 'Node.js is too old, skipping web UI build',
      detail: `Found v${nodeVersion}; requires Node.js ${NODE_WEB_UI_REQUIREMENT}`,
    });
    return;
  }

  onProgress({ phase: 'build-ui', message: 'Installing web UI dependencies...' });

  await spawnWithProgress(
    'npm',
    ['install'],
    { cwd: uiDir, shell: true },
    (line) => {
      onProgress({ phase: 'build-ui', message: 'npm install...', detail: line });
    },
  );

  onProgress({ phase: 'build-ui', message: 'Building web UI...' });

  await spawnWithProgress(
    'npm',
    ['run', 'build'],
    { cwd: uiDir, shell: true },
    (line) => {
      onProgress({ phase: 'build-ui', message: 'Building UI...', detail: line });
    },
  );
}

export async function cmakeConfigure(
  llamaCppDir: string,
  prereqs: PrerequisiteStatus,
  onProgress: ProgressCallback,
): Promise<void> {
  if (!prereqs.cmake.path) throw new Error('CMake not found');

  onProgress({ phase: 'cmake-configure', message: 'Configuring CMake project...' });

  const msvcToolset = findMsvcToolset(prereqs.cmake.path, prereqs.cuda.found);
  const cmakeEnv = buildCmakeEnv(prereqs, msvcToolset);

  if (msvcToolset) {
    onProgress({
      phase: 'cmake-configure',
      message: 'Using MSVC toolset...',
      detail: `${msvcToolset.version} (${msvcToolset.binDir})`,
    });
  }

  // clean old build cache
  const buildDir = join(llamaCppDir, 'build');
  if (existsSync(buildDir)) {
    onProgress({ phase: 'cmake-configure', message: 'Cleaning old build cache...' });
    await spawnWithProgress(
      'powershell',
      ['-NoProfile', '-Command', `Remove-Item -Recurse -Force "${buildDir}"`],
      {},
      () => {},
    );
  }

  const args = [
    '-B', 'build',
    '-G', 'Visual Studio 17 2022',
    '-A', 'x64',
    '-T', getVsToolsetArg(prereqs, msvcToolset),
  ];

  if (prereqs.cuda.found && prereqs.cuda.version) {
    args.push('-DGGML_CUDA=ON');
    if (prereqs.cuda.path) {
      args.push(`-DCUDAToolkit_ROOT=${prereqs.cuda.path}`);
    }
  }

  if (prereqs.gpu.arch) {
    args.push(`-DCMAKE_CUDA_ARCHITECTURES=${prereqs.gpu.arch}`);
  }

  args.push('-DLLAMA_BUILD_BORINGSSL=ON');
  args.push('-DLLAMA_BUILD_UI=ON');

  try {
    await spawnWithProgress(
      prereqs.cmake.path,
      args,
      { cwd: llamaCppDir, env: cmakeEnv },
      (line) => {
        onProgress({ phase: 'cmake-configure', message: 'Configuring...', detail: line });
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("Cannot find compiler 'cl.exe'") ||
      message.includes('CMakeCUDACompilerId') ||
      message.includes('CUDA compiler identification')
    ) {
      throw new Error(
        `${message}\n\n` +
        'CUDA configure failed while CMake was checking nvcc. The launcher added the MSVC compiler directory to PATH and set CUDAHOSTCXX; if this still fails, install a CUDA-compatible Visual Studio 2022 v143 C++ toolset or update CUDA Toolkit.',
      );
    }
    throw err;
  }
}

export async function cmakeBuild(
  llamaCppDir: string,
  prereqs: PrerequisiteStatus,
  onProgress: ProgressCallback,
): Promise<void> {
  if (!prereqs.cmake.path) throw new Error('CMake not found');

  onProgress({ phase: 'cmake-build', message: 'Compiling llama-server...' });

  const cores = Math.max(1, prereqs.cpuCores);
  const msvcToolset = findMsvcToolset(prereqs.cmake.path, prereqs.cuda.found);
  const cmakeEnv = buildCmakeEnv(prereqs, msvcToolset);

  if (msvcToolset) {
    onProgress({
      phase: 'cmake-build',
      message: 'Using MSVC toolset...',
      detail: `${msvcToolset.version} (${msvcToolset.binDir})`,
    });
  }

  await spawnWithProgress(
    prereqs.cmake.path,
    ['--build', 'build', '--config', 'Release', '-j', String(cores), '--target', 'llama-server'],
    { cwd: llamaCppDir, env: cmakeEnv },
    (line) => {
      let percent: number | undefined;
      const match = line.match(/\[(\d+)\/(\d+)\]/);
      if (match) {
        const current = parseInt(match[1], 10);
        const total = parseInt(match[2], 10);
        percent = Math.round((current / total) * 100);
      }
      onProgress({ phase: 'cmake-build', message: 'Building...', detail: line, percent });
    },
  );
}

export async function runFullInstall(
  targetDir: string,
  prereqs: PrerequisiteStatus,
  onProgress: ProgressCallback,
): Promise<string> {
  await cloneRepo(targetDir, onProgress);
  await buildWebUI(targetDir, onProgress);
  await cmakeConfigure(targetDir, prereqs, onProgress);
  await cmakeBuild(targetDir, prereqs, onProgress);

  onProgress({ phase: 'done', message: 'Installation complete!' });
  return targetDir;
}

// ── Update Functions ──

export async function pullAndRebuild(
  llamaCppDir: string,
  prereqs: PrerequisiteStatus,
  onProgress: ProgressCallback,
): Promise<void> {
  onProgress({ phase: 'clone', message: 'Pulling latest changes...' });

  await spawnWithProgress(
    'git',
    ['pull', '--progress'],
    { cwd: llamaCppDir },
    (line) => {
      onProgress({ phase: 'clone', message: 'git pull...', detail: line });
    },
  );

  await buildWebUI(llamaCppDir, onProgress);
  await cmakeConfigure(llamaCppDir, prereqs, onProgress);
  await cmakeBuild(llamaCppDir, prereqs, onProgress);

  onProgress({ phase: 'done', message: 'Update complete!' });
}
