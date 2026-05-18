import chalk from 'chalk';
import gradient from 'gradient-string';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { SelectionResult } from './selection.js';
import { buildServerArgs, validateServer } from './services/server.js';
import { formatNumber, formatMb } from './utils/format.js';

const coolGradient = gradient(['#6366f1', '#8b5cf6', '#d946ef']);

export function launchServer(result: SelectionResult): void {
  const { config, hardware, network, selection } = result;

  const validation = validateServer(config);
  if (!validation.ok) {
    console.error(chalk.red(`\n  ✖ ${validation.error}\n`));
    process.exit(1);
  }

  const purple = chalk.hex('#8b5cf6');
  const dim = chalk.dim;
  const border = chalk.hex('#6366f1');

  console.log('');
  console.log(border('╭' + '─'.repeat(62) + '╮'));
  console.log(border('│') + '  ' + coolGradient('LLAMA.CPP SERVER') + ' '.repeat(44) + border('│'));
  console.log(border('╰' + '─'.repeat(62) + '╯'));
  console.log('');

  const row = (label: string, value: string) => {
    console.log(`  ${purple(label.padEnd(12))}${value}`);
  };

  row('Model', selection.model.label);
  row('Engine', config.serverExe);

  if (hardware) {
    row('GPU', `${hardware.gpuName} │ ${formatMb(hardware.vramMb)}`);
    row('CPU', `${hardware.cpuName} │ ${formatMb(hardware.ramMb)} RAM`);
  }

  console.log('');
  row('Local', network?.localUrl || `http://localhost:${config.port}`);
  row('Network', network?.lanUrl || 'unavailable');
  console.log('');
  console.log(`  ${dim(`Context ${formatNumber(selection.contextSize)} │ Layers ${config.gpuLayers} │ Slots ${config.parallelSlots} │ MTP ${selection.mtpEnabled ? 'on' : 'off'}`)}`);
  console.log(`  ${dim('─'.repeat(60))}`);
  console.log('');

  const args = buildServerArgs(config, selection);
  const serverPath = join(config.serverDir, config.serverExe);

  const title = `llama.cpp | ${selection.model.label} | :${config.port}`;
  process.title = title;

  const proc = spawn(serverPath, args, {
    cwd: config.serverDir,
    stdio: 'inherit',
  });

  proc.on('exit', (code) => {
    console.log('');
    if (code !== 0 && code !== null) {
      console.log(chalk.red(`  ✖ Server exited with code ${code}`));
    } else {
      console.log(dim('  Server stopped.'));
    }
    process.exit(code ?? 0);
  });

  proc.on('error', (err) => {
    console.error(chalk.red(`\n  ✖ Failed to start server: ${err.message}\n`));
    process.exit(1);
  });

  process.on('SIGINT', () => {
    proc.kill();
  });

  process.on('SIGTERM', () => {
    proc.kill();
  });
}
