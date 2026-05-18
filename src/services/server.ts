import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Config, FullSelection } from '../types.js';

function buildModelArgs(selection: FullSelection): string[] {
  const { model } = selection;
  if (model.mode === 'local') {
    return ['-m', model.path];
  }
  const args = ['-hf', model.repo];
  if (model.file) {
    args.push('--hf-file', model.file);
  }
  return args;
}

export function buildServerArgs(config: Config, selection: FullSelection): string[] {
  const args = [
    '--tools', 'all',
    '--host', config.host,
    '--port', String(config.port),
    ...buildModelArgs(selection),
    '-c', String(selection.contextSize),
    '-fa', 'on',
    '-ngl', String(config.gpuLayers),
    '-np', String(config.parallelSlots),
  ];

  if (selection.mtpEnabled) {
    args.push('--spec-type', 'draft-mtp', '--spec-draft-n-max', String(config.draftTokens));
  }

  return args;
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
