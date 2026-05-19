import { spawn, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import type { SpawnOptions } from 'node:child_process';

// ── Types ──

export interface PrerequisiteStatus {
  git: { found: boolean; version: string | null };
  cmake: { found: boolean; path: string | null; vsEdition: string | null };
  cuda: { found: boolean; path: string | null; version: string | null; allVersions: string[] };
  node: { found: boolean; version: string | null; nvmFound: boolean };
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
}

export type ProgressCallback = (progress: InstallProgress) => void;

// ── GPU arch fallback map ──

const GPU_ARCH_MAP: Record<string, number> = {
  '5090': 120, '5080': 120, '5070': 120, '5060': 120,
  '4090': 89,  '4080': 89,  '4070': 89,  '4060': 89,
  '3090': 86,  '3080': 86,  '3070': 86,  '3060': 86,
  '2080': 75,  '2070': 75,  '2060': 75,
};

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
  const raw = tryExec('git --version');
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
  const nvmVersion = tryExec('nvm version');
  const nvmFound = nvmVersion !== null && nvmVersion !== '' && nvmVersion !== 'No current version';
  const nodeVersion = tryExec('node --version');
  const version = nodeVersion?.replace(/^v/, '') || null;
  return { found: version !== null, version, nvmFound };
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

export function getMissingPrerequisites(status: PrerequisiteStatus): string[] {
  const missing: string[] = [];
  if (!status.git.found) missing.push('Git');
  if (!status.cmake.found) missing.push('Visual Studio 2022');
  if (!status.cuda.found) missing.push('CUDA Toolkit');
  if (!status.gpu.name) missing.push('NVIDIA GPU');
  return missing;
}

export function canAutoInstall(name: string): boolean {
  return name === 'Git' || name === 'NVM';
}

// ── Auto-install via winget ──

export async function autoInstallPrereq(
  name: 'Git' | 'NVM',
  onProgress: ProgressCallback,
): Promise<boolean> {
  const wingetId = name === 'Git' ? 'Git.Git' : 'CoreyButler.NVMforWindows';
  const phase: InstallPhase = 'clone'; // reuse phase for progress display

  onProgress({ phase, message: `Installing ${name} via winget...` });

  try {
    await spawnWithProgress(
      'winget',
      ['install', '--id', wingetId, '-e', '--accept-source-agreements', '--accept-package-agreements'],
      {},
      (line) => {
        onProgress({ phase, message: `Installing ${name}...`, detail: line });
      },
    );
    return true;
  } catch {
    return false;
  }
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

  // install node via nvm if available
  const nvmVersion = tryExec('nvm version');
  if (nvmVersion !== null) {
    onProgress({ phase: 'build-ui', message: 'Setting up Node.js via NVM...' });
    tryExec('nvm install 22.13.0');
    tryExec('nvm use 22.13.0');
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
  ];

  if (prereqs.cuda.found && prereqs.cuda.version) {
    args.push('-T', `cuda=${prereqs.cuda.version}`);
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

  await spawnWithProgress(
    prereqs.cmake.path,
    args,
    { cwd: llamaCppDir },
    (line) => {
      onProgress({ phase: 'cmake-configure', message: 'Configuring...', detail: line });
    },
  );
}

export async function cmakeBuild(
  llamaCppDir: string,
  prereqs: PrerequisiteStatus,
  onProgress: ProgressCallback,
): Promise<void> {
  if (!prereqs.cmake.path) throw new Error('CMake not found');

  onProgress({ phase: 'cmake-build', message: 'Compiling llama-server...' });

  const cores = Math.max(1, prereqs.cpuCores);

  await spawnWithProgress(
    prereqs.cmake.path,
    ['--build', 'build', '--config', 'Release', '-j', String(cores), '--target', 'llama-server'],
    { cwd: llamaCppDir },
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
