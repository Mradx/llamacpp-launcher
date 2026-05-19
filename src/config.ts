import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { StoredConfig, Config } from './types.js';
import { getDataPath, getPackageResourcePath } from './storage.js';

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

export function resolveConfig(stored: StoredConfig): Config {
  return {
    ...stored,
    serverDir: join(stored.llamaCppDir, 'build', 'bin', 'Release'),
    serverExe: 'llama-server.exe',
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
  const buildDir = join(expanded, 'build', 'bin', 'Release');
  if (!existsSync(buildDir)) {
    return { ok: false, error: `Build directory not found: ${buildDir}\nRun: cmake --build build --config Release` };
  }
  const exePath = join(buildDir, 'llama-server.exe');
  if (!existsSync(exePath)) {
    return { ok: false, error: `llama-server.exe not found in ${buildDir}\nRun: cmake --build build --config Release` };
  }
  return { ok: true };
}
