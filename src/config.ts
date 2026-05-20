import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { StoredConfig, Config } from './types.js';
import { getDataPath, getPackageResourcePath } from './storage.js';
import { isWindows, serverBinaryName } from './utils/platform.js';

const StoredConfigSchema = z.object({
  llamaCppDir: z.string(),
  hfCachePath: z.string(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  parallelSlots: z.number().int().min(1),
  draftTokens: z.number().int().min(0),
  contextOptions: z.array(z.number().int().positive()),
});

function expandPath(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

function migrateOldConfig(raw: Record<string, unknown>): Record<string, unknown> {
  if ('serverDir' in raw && !('llamaCppDir' in raw)) {
    const serverDir = String(raw.serverDir);
    const suffix = join('build', 'bin', 'Release');
    const normalized = serverDir.replace(/[\\/]+$/, '');
    if (normalized.endsWith(suffix) || normalized.endsWith(suffix.replace(/\\/g, '/'))) {
      raw.llamaCppDir = normalized.slice(0, -(suffix.length + 1));
    } else {
      raw.llamaCppDir = normalized;
    }
  }
  delete raw.serverDir;
  delete raw.serverExe;
  delete raw.defaultContext;
  delete raw.gpuLayers;
  return raw;
}

export function loadStoredConfig(): StoredConfig {
  const defaultPath = getPackageResourcePath('config.default.json');
  const userPath = getDataPath('config.json');

  const defaults = JSON.parse(readFileSync(defaultPath, 'utf-8'));

  let userOverrides: Record<string, unknown> = {};
  let needsMigration = false;
  if (existsSync(userPath)) {
    try {
      const raw = JSON.parse(readFileSync(userPath, 'utf-8'));
      if ('serverDir' in raw && !('llamaCppDir' in raw)) {
        needsMigration = true;
        migrateOldConfig(raw);
      }
      userOverrides = raw;
    } catch {
      // ignore invalid user config
    }
  }

  const merged = { ...defaults, ...userOverrides };
  const config = StoredConfigSchema.parse(merged);

  const stored: StoredConfig = {
    ...config,
    llamaCppDir: expandPath(config.llamaCppDir),
    hfCachePath: expandPath(config.hfCachePath),
  };

  if (needsMigration) {
    saveUserConfig(stored);
  }

  return stored;
}

// Build-output layouts differ by CMake generator: Windows (Visual Studio,
// multi-config) emits build/bin/Release/, while single-config generators used on
// macOS/Linux (Ninja, Unix Makefiles) emit build/bin/. Prefer a layout whose
// binary actually exists, else fall back to the platform default.
function serverLayoutCandidates(): string[][] {
  return isWindows()
    ? [['build', 'bin', 'Release'], ['build', 'bin']]
    : [['build', 'bin'], ['build', 'bin', 'Release']];
}

export function resolveServerLocation(llamaCppDir: string): { serverDir: string; serverExe: string } {
  const serverExe = serverBinaryName();
  const candidates = serverLayoutCandidates();
  for (const sub of candidates) {
    const serverDir = join(llamaCppDir, ...sub);
    if (existsSync(join(serverDir, serverExe))) {
      return { serverDir, serverExe };
    }
  }
  return { serverDir: join(llamaCppDir, ...candidates[0]), serverExe };
}

export function resolveConfig(stored: StoredConfig): Config {
  const { serverDir, serverExe } = resolveServerLocation(stored.llamaCppDir);
  return {
    ...stored,
    serverDir,
    serverExe,
  };
}

export function loadConfig(): Config {
  return resolveConfig(loadStoredConfig());
}

export function saveUserConfig(config: StoredConfig): void {
  const userPath = getDataPath('config.json');
  const toSave: Record<string, unknown> = {
    llamaCppDir: config.llamaCppDir,
    hfCachePath: config.hfCachePath,
    host: config.host,
    port: config.port,
    parallelSlots: config.parallelSlots,
    draftTokens: config.draftTokens,
    contextOptions: config.contextOptions,
  };
  writeFileSync(userPath, JSON.stringify(toSave, null, 2) + '\n', 'utf-8');
}

export function isFirstRun(): boolean {
  const userPath = getDataPath('config.json');
  return !existsSync(userPath);
}

export function validateLlamaCppDir(dir: string): { ok: boolean; error?: string } {
  if (!dir) {
    return { ok: false, error: 'Path cannot be empty' };
  }
  const expanded = expandPath(dir);
  if (!existsSync(expanded)) {
    return { ok: false, error: `Directory not found: ${expanded}` };
  }
  const buildCmd = isWindows()
    ? 'cmake --build build --config Release --target llama-server'
    : 'cmake --build build --target llama-server';
  const { serverDir, serverExe } = resolveServerLocation(expanded);
  if (!existsSync(serverDir)) {
    return { ok: false, error: `Build directory not found: ${serverDir}\nRun: ${buildCmd}` };
  }
  const exePath = join(serverDir, serverExe);
  if (!existsSync(exePath)) {
    return { ok: false, error: `${serverExe} not found in ${serverDir}\nRun: ${buildCmd}` };
  }
  return { ok: true };
}
