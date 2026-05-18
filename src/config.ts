import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Config } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const ConfigSchema = z.object({
  serverDir: z.string(),
  serverExe: z.string(),
  hfCachePath: z.string(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  defaultContext: z.number().int().positive(),
  gpuLayers: z.number().int().min(0),
  parallelSlots: z.number().int().min(1),
  draftTokens: z.number().int().min(1),
  contextOptions: z.array(z.number().int().positive()),
});

function expandPath(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

export function loadConfig(): Config {
  const defaultPath = resolve(projectRoot, 'config.default.json');
  const userPath = resolve(projectRoot, 'config.json');

  const defaults = JSON.parse(readFileSync(defaultPath, 'utf-8'));

  let userOverrides = {};
  if (existsSync(userPath)) {
    try {
      userOverrides = JSON.parse(readFileSync(userPath, 'utf-8'));
    } catch {
      // ignore invalid user config, use defaults
    }
  }

  const merged = { ...defaults, ...userOverrides };
  const config = ConfigSchema.parse(merged);

  return {
    ...config,
    serverDir: expandPath(config.serverDir),
    hfCachePath: expandPath(config.hfCachePath),
  };
}
