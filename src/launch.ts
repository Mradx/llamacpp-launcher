import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { SelectionResult } from './selection.js';
import { buildServerArgs, buildServerEnv, buildServerEnvOverrides, validateServer } from './services/server.js';
import { formatNumber, formatMb } from './utils/format.js';
import { LLAMA_CPP_LOGO } from './brand.js';
import { theme } from './theme.js';

export function launchServer(result: SelectionResult): void {
  const { config, hardware, network, selection } = result;
  const isRouter = selection.model.mode === 'router';

  const validation = validateServer(config);
  if (!validation.ok) {
    console.error(chalk.red(`\n  ✖ ${validation.error}\n`));
    process.exit(1);
  }

  const labelColor = chalk.hex(theme.accent);
  const dim = chalk.dim;
  const logoText = chalk.hex(theme.logoText).bold;
  const logoAccent = chalk.hex(theme.logoAccent).bold;
  const titleAccent = chalk.hex(theme.accentStrong).bold;

  console.log('');
  for (const line of LLAMA_CPP_LOGO) {
    console.log('  ' + logoText(line.llama) + logoAccent(line.cpp));
  }
  console.log('');
  console.log('  ' + titleAccent('▌ ') + chalk.bold('LLAMA.CPP SERVER'));
  console.log('');

  const row = (label: string, value: string) => {
    console.log(`  ${labelColor(label.padEnd(12))}${value}`);
  };

  row('Model', selection.model.label);
  row('Engine', config.serverExe);
  if (isRouter && selection.router) {
    const enabled = selection.router.models.filter(model => model.enabled).length;
    row('Preset', selection.router.presetPath);
    row('Models', `${enabled} enabled`);
    row('Max loaded', selection.router.modelsMax === 0 ? 'unlimited' : String(selection.router.modelsMax));
    row('Autoload', selection.router.autoload ? 'on request' : 'off');
  } else if (selection.metadata) {
    const m = selection.metadata;
    if (m.architecture) row('Architecture', m.architecture);
    if (m.blockCount) {
      const mtpSuffix = m.nextNPredictLayers ? ` + ${m.nextNPredictLayers} MTP` : '';
      row('Layers', `${m.blockCount}${mtpSuffix}${m.isEstimated ? ' (estimated)' : ''}`);
    }
    if (m.contextLength) row('Train ctx', formatNumber(m.contextLength));
    if (m.primaryQuantType) row('Quant', m.primaryQuantType);
  }

  if (hardware) {
    row('GPU', `${hardware.gpuName} │ ${formatMb(hardware.vramMb)}`);
    row('CPU', `${hardware.cpuName} │ ${formatMb(hardware.ramMb)} RAM`);
  }

  console.log('');
  row('Local', network?.localUrl || `http://localhost:${config.port}`);
  row('Network', network?.lanUrl || 'unavailable');
  console.log('');
  if (isRouter && selection.router) {
    console.log(`  ${dim(`Router mode │ models.ini controls context, GPU layers, slots and MTP per model`)}`);
  } else {
    console.log(`  ${dim(`Context ${formatNumber(selection.contextSize)} │ GPU Layers ${selection.gpuLayers} │ Slots ${config.parallelSlots} │ MTP ${selection.mtpEnabled ? 'on' : 'off'}`)}`);
  }

  if (isRouter) {
    row('Sampling', 'client request or per-model preset');
  } else if (selection.params) {
    const p = selection.params;
    const parts: string[] = [];
    if (p.temp !== undefined) parts.push(`temp=${p.temp}`);
    if (p.top_k !== undefined) parts.push(`top_k=${p.top_k}`);
    if (p.top_p !== undefined) parts.push(`top_p=${p.top_p}`);
    if (p.min_p !== undefined) parts.push(`min_p=${p.min_p}`);
    if (p.presence_penalty !== undefined) parts.push(`pres_pen=${p.presence_penalty}`);
    if (p.frequency_penalty !== undefined) parts.push(`freq_pen=${p.frequency_penalty}`);
    if (p.repeat_penalty !== undefined) parts.push(`rep_pen=${p.repeat_penalty}`);
    row('Sampling', parts.join(', '));
  } else if (selection.rawArgs && selection.rawArgs.length > 0) {
    row('Sampling', selection.rawArgs.join(' '));
  } else {
    row('Sampling', 'llama.cpp defaults');
  }

  if (!isRouter) {
    row('Reasoning', selection.reasoningMode);
  }

  const envOverrides = buildServerEnvOverrides(config);

  if (selection.chatTemplateOverride) {
    row('Template', 'custom override');
  }
  if (envOverrides.GGML_CUDA_PDL) {
    row('CUDA PDL', config.cudaPdl === 'off' ? 'off (GGML_CUDA_PDL=0)' : 'on (GGML_CUDA_PDL=1)');
  }

  console.log(`  ${dim('─'.repeat(60))}`);
  console.log('');

  const args = buildServerArgs(config, selection);
  const serverPath = join(config.serverDir, config.serverExe);

  const envPrefix = Object.entries(envOverrides)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  const commandPreview = envPrefix ? `${envPrefix} ${config.serverExe}` : config.serverExe;
  console.log(`  ${labelColor('Command')}  ${dim(commandPreview)} ${dim(args.join(' '))}`);
  console.log('');

  const title = isRouter
    ? `llama.cpp router | :${config.port}`
    : `llama.cpp | ${selection.model.label} | :${config.port}`;
  process.title = title;

  const proc = spawn(serverPath, args, {
    cwd: config.serverDir,
    env: buildServerEnv(config),
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
