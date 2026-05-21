import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Config, FullSelection } from '../types.js';

function buildModelArgs(selection: FullSelection): string[] {
  const { model } = selection;
  if (model.mode === 'local') {
    return ['-m', model.path];
  }
  if (model.mode === 'router') {
    throw new Error('Router mode does not use model args');
  }
  const args = ['-hf', model.repo];
  if (model.file) {
    args.push('--hf-file', model.file);
  }
  return args;
}

export function buildServerArgs(config: Config, selection: FullSelection): string[] {
  if (selection.model.mode === 'router') {
    const router = selection.router;
    if (!router) {
      throw new Error('Router selection missing launch config');
    }

    const args = [
      '--host', config.host,
      '--port', String(config.port),
      '--models-preset', router.presetPath,
      '--models-max', String(router.modelsMax),
    ];

    args.push(router.autoload ? '--models-autoload' : '--no-models-autoload');
    if (router.sleepIdleSeconds >= 0) {
      args.push('--sleep-idle-seconds', String(router.sleepIdleSeconds));
    }

    return args;
  }

  const args = [
    '--tools', 'all',
    '--host', config.host,
    '--port', String(config.port),
    ...buildModelArgs(selection),
    '-c', String(selection.contextSize),
    '-fa', 'on',
    '-ngl', String(selection.gpuLayers),
    '-np', String(config.parallelSlots),
  ];

  if (selection.mtpEnabled) {
    args.push('--spec-type', 'draft-mtp', '--spec-draft-n-max', String(config.draftTokens));
  }

  if (selection.params) {
    const p = selection.params;
    if (p.temp !== undefined) args.push('--temp', String(p.temp));
    if (p.top_k !== undefined) args.push('--top-k', String(p.top_k));
    if (p.top_p !== undefined) args.push('--top-p', String(p.top_p));
    if (p.min_p !== undefined) args.push('--min-p', String(p.min_p));
    if (p.presence_penalty !== undefined) args.push('--presence-penalty', String(p.presence_penalty));
    if (p.frequency_penalty !== undefined) args.push('--frequency-penalty', String(p.frequency_penalty));
    if (p.repeat_penalty !== undefined) args.push('--repeat-penalty', String(p.repeat_penalty));
  }

  if (selection.chatTemplateOverride) {
    args.push('--chat-template-str', selection.chatTemplateOverride);
  }

  if (selection.rawArgs && selection.rawArgs.length > 0) {
    args.push(...selection.rawArgs);
  }

  return args;
}

export function buildServerEnvOverrides(config: Config): Record<string, string> {
  if (config.cudaPdl === 'on') {
    return { GGML_CUDA_PDL: '1' };
  }
  if (config.cudaPdl === 'off') {
    return { GGML_CUDA_PDL: '0' };
  }
  return {};
}

export function buildServerEnv(config: Config): NodeJS.ProcessEnv {
  const overrides = buildServerEnvOverrides(config);
  if (Object.keys(overrides).length === 0) {
    return process.env;
  }
  return { ...process.env, ...overrides };
}

export function validateServer(config: Config): { ok: boolean; error?: string } {
  const serverPath = join(config.serverDir, config.serverExe);
  if (!existsSync(config.serverDir)) {
    return { ok: false, error: `Server directory not found: ${config.serverDir}` };
  }
  if (!existsSync(serverPath)) {
    return { ok: false, error: `Server executable not found: ${serverPath}` };
  }
  return { ok: true };
}

export function spawnServer(
  config: Config,
  args: string[],
  onStdout: (data: string) => void,
  onStderr: (data: string) => void,
  onExit: (code: number | null) => void
): ChildProcess {
  const serverPath = join(config.serverDir, config.serverExe);

  const proc = spawn(serverPath, args, {
    cwd: config.serverDir,
    env: buildServerEnv(config),
    windowsHide: false,
  });

  proc.stdout?.on('data', (chunk: Buffer) => {
    onStdout(chunk.toString('utf-8'));
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    onStderr(chunk.toString('utf-8'));
  });

  proc.on('exit', (code) => {
    onExit(code);
  });

  return proc;
}
