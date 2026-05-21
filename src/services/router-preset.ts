import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDataPath } from '../storage.js';
import type { Config, HardwareInfo, LocalModel, ModelParams, ReasoningMode, RouterLaunchConfig, RouterModelConfig } from '../types.js';
import { calculateKvCache, calculateMaxGpuLayers } from './memory.js';
import { detectMtp } from './mtp.js';

export const ROUTER_SLEEP_OPTIONS = [-1, 60, 300, 900, 3600];

interface ParsedRouterModelPreset {
  alias: string;
  path: string;
  contextSize?: number;
  gpuLayers?: number;
  parallelSlots?: number;
  loadOnStartup?: boolean;
  mtpEnabled?: boolean;
  reasoningMode?: ReasoningMode;
  params: ModelParams | null;
  rawArgs: string[];
}

export interface ParsedRouterPreset {
  modelsMax?: number;
  autoload?: boolean;
  sleepIdleSeconds?: number;
  disabledModelPaths: string[];
  models: ParsedRouterModelPreset[];
}

function stripGgufSuffix(fileName: string): string {
  return fileName
    .replace(/\.gguf$/i, '')
    .replace(/-\d{5}-of-\d{5}$/i, '');
}

function slugifyAlias(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\.gguf$/i, '')
    .replace(/-\d{5}-of-\d{5}$/i, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'model';
}

function uniqueAlias(base: string, used: Set<string>): string {
  let alias = base;
  let suffix = 2;
  while (used.has(alias)) {
    alias = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(alias);
  return alias;
}

function defaultContext(options: number[]): number {
  return options[Math.floor(options.length / 2)] || 4096;
}

const PARAM_KEYS: Array<[keyof ModelParams, string]> = [
  ['temp', 'temp'],
  ['top_k', 'top-k'],
  ['top_p', 'top-p'],
  ['min_p', 'min-p'],
  ['presence_penalty', 'presence-penalty'],
  ['frequency_penalty', 'frequency-penalty'],
  ['repeat_penalty', 'repeat-penalty'],
  ['top_n_sigma', 'top-n-sigma'],
  ['dynatemp_range', 'dynatemp-range'],
  ['mirostat', 'mirostat'],
  ['mirostat_tau', 'mirostat-ent'],
  ['mirostat_eta', 'mirostat-lr'],
];

const PARAM_NAME_TO_KEY = new Map(PARAM_KEYS.map(([key, argName]) => [argName, key]));
const RESERVED_MODEL_KEYS = new Set([
  'model',
  'c',
  'ctx-size',
  'n-ctx',
  'n-gpu-layers',
  'ngl',
  'np',
  'parallel',
  'load-on-startup',
  'spec-type',
  'spec-draft-n-max',
  'jinja',
  'reasoning',
  'rea',
]);

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseNumberValue(value: string): number | undefined {
  const scalar = parseScalar(value);
  if (scalar === '') return undefined;
  const parsed = Number(scalar);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolValue(value: string): boolean | undefined {
  const normalized = parseScalar(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function parseReasoningMode(value: string | undefined): ReasoningMode | undefined {
  if (value === undefined) return undefined;
  const normalized = parseScalar(value).toLowerCase();
  if (normalized === 'auto' || normalized === 'on' || normalized === 'off') {
    return normalized;
  }
  return undefined;
}

function normalizePathKey(path: string): string {
  return resolve(path);
}

function parseKeyValue(line: string): { key: string; value: string } | null {
  const eqIndex = line.indexOf('=');
  if (eqIndex < 0) return null;
  return {
    key: line.slice(0, eqIndex).trim(),
    value: line.slice(eqIndex + 1).trim(),
  };
}

function readLauncherMeta(line: string, preset: ParsedRouterPreset): boolean {
  const match = line.match(/^#\s*llamacpp-launcher\.([^=]+?)\s*=\s*(.*)$/);
  if (!match) return false;

  const key = match[1].trim();
  const value = parseScalar(match[2]);
  if (key === 'models-max') {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) preset.modelsMax = parsed;
  } else if (key === 'models-autoload') {
    const parsed = parseBoolValue(value);
    if (parsed !== undefined) preset.autoload = parsed;
  } else if (key === 'sleep-idle-seconds') {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) preset.sleepIdleSeconds = parsed;
  } else if (key === 'disabled-model') {
    preset.disabledModelPaths.push(value);
  }
  return true;
}

export function parseRouterPresetContent(content: string): ParsedRouterPreset {
  const preset: ParsedRouterPreset = {
    disabledModelPaths: [],
    models: [],
  };
  let currentSection: { name: string; values: Map<string, string> } | null = null;

  const flushSection = () => {
    if (!currentSection || currentSection.name === '*') return;

    const path = currentSection.values.get('model');
    if (!path) return;

    const params: ModelParams = {};
    const rawArgs: string[] = [];
    for (const [key, value] of currentSection.values) {
      const paramKey = PARAM_NAME_TO_KEY.get(key);
      if (paramKey) {
        const parsed = parseNumberValue(value);
        if (parsed !== undefined) {
          (params as any)[paramKey] = parsed;
        }
        continue;
      }

      if (RESERVED_MODEL_KEYS.has(key)) continue;

      const boolValue = parseBoolValue(value);
      if (boolValue === true) {
        rawArgs.push(`--${key}`);
      } else if (boolValue !== false) {
        rawArgs.push(`--${key}`, parseScalar(value));
      }
    }

    const contextSize = parseNumberValue(currentSection.values.get('c') ?? currentSection.values.get('ctx-size') ?? '');
    const gpuLayers = parseNumberValue(currentSection.values.get('n-gpu-layers') ?? currentSection.values.get('ngl') ?? '');
    const parallelSlots = parseNumberValue(currentSection.values.get('np') ?? currentSection.values.get('parallel') ?? '');
    const loadOnStartup = currentSection.values.has('load-on-startup')
      ? parseBoolValue(currentSection.values.get('load-on-startup')!)
      : undefined;
    const specType = currentSection.values.get('spec-type');
    const reasoningMode = parseReasoningMode(
      currentSection.values.get('reasoning') ?? currentSection.values.get('rea'),
    );

    preset.models.push({
      alias: currentSection.name,
      path: parseScalar(path),
      contextSize,
      gpuLayers,
      parallelSlots,
      loadOnStartup,
      mtpEnabled: specType ? parseScalar(specType) === 'draft-mtp' : undefined,
      reasoningMode,
      params: Object.keys(params).length > 0 ? params : null,
      rawArgs,
    });
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith(';')) {
      readLauncherMeta(line, preset);
      continue;
    }

    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      flushSection();
      currentSection = { name: sectionMatch[1].trim(), values: new Map() };
      continue;
    }

    if (!currentSection) continue;
    const pair = parseKeyValue(line);
    if (pair) currentSection.values.set(pair.key, pair.value);
  }
  flushSection();

  return preset;
}

function loadRouterPreset(path: string): ParsedRouterPreset | null {
  if (!existsSync(path)) return null;
  try {
    return parseRouterPresetContent(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function stripArgPrefix(arg: string): string {
  return arg.replace(/^-+/, '');
}

function appendRawArgs(lines: string[], rawArgs: string[]): void {
  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index];
    if (!arg.startsWith('-')) continue;

    const key = stripArgPrefix(arg);
    const next = rawArgs[index + 1];
    if (next && !next.startsWith('-')) {
      lines.push(`${key} = ${next}`);
      index += 1;
    } else {
      lines.push(`${key} = true`);
    }
  }
}

function hasReasoningArg(rawArgs: string[]): boolean {
  return rawArgs.some(arg => arg === '--reasoning' || arg === '-rea');
}

function appendReasoningMode(lines: string[], mode: ReasoningMode | undefined, rawArgs: string[]): void {
  if (mode && mode !== 'auto' && !hasReasoningArg(rawArgs)) {
    lines.push(`reasoning = ${mode}`);
  }
}

function appendModelParams(lines: string[], params: ModelParams | null): void {
  if (!params) return;
  for (const [key, argName] of PARAM_KEYS) {
    const value = params[key];
    if (value !== undefined) {
      lines.push(`${argName} = ${value}`);
    }
  }
}

export function getRouterPresetPath(): string {
  return getDataPath('models.ini');
}

export function createRouterLaunchConfig(
  models: LocalModel[],
  contextOptions: number[],
  config: Config,
  savedPreset?: ParsedRouterPreset | null,
): RouterLaunchConfig {
  const usedAliases = new Set<string>();
  const contextSize = defaultContext(contextOptions);
  const presetPath = getRouterPresetPath();
  const saved = savedPreset === undefined ? loadRouterPreset(presetPath) : savedPreset;
  const savedByPath = new Map((saved?.models ?? []).map(model => [normalizePathKey(model.path), model]));
  const disabledPaths = new Set((saved?.disabledModelPaths ?? []).map(normalizePathKey));

  return {
    presetPath,
    modelsMax: saved?.modelsMax ?? 1,
    autoload: saved?.autoload ?? true,
    sleepIdleSeconds: saved?.sleepIdleSeconds ?? 300,
    models: models.map((model) => {
      const savedModel = savedByPath.get(normalizePathKey(model.path));
      const label = model.metadata?.name || stripGgufSuffix(model.fileName);
      const aliasBase = savedModel?.alias || slugifyAlias(`${model.repoId}-${stripGgufSuffix(model.fileName)}`);
      const params = savedModel?.params ?? null;
      const rawArgs = savedModel?.rawArgs ?? [];
      return {
        alias: uniqueAlias(aliasBase, usedAliases),
        label,
        path: model.path,
        fileName: model.fileName,
        repoId: model.repoId,
        sizeBytes: model.sizeBytes,
        enabled: savedModel ? true : !disabledPaths.has(normalizePathKey(model.path)),
        contextSize: savedModel?.contextSize ?? contextSize,
        gpuLayers: savedModel?.gpuLayers ?? 999,
        parallelSlots: savedModel?.parallelSlots ?? config.parallelSlots,
        loadOnStartup: savedModel?.loadOnStartup ?? false,
        mtpEnabled: savedModel?.mtpEnabled ?? detectMtp(model.metadata, model.repoId, model.fileName),
        reasoningMode: savedModel?.reasoningMode ?? 'auto',
        params,
        paramsLabel: rawArgs.length > 0
          ? 'Expert flags'
          : params
            ? 'Saved params'
            : 'llama.cpp defaults',
        rawArgs,
        metadata: model.metadata,
      };
    }),
  };
}

export function recommendedGpuLayers(model: RouterModelConfig, hardware?: HardwareInfo | null): number {
  if (!hardware || hardware.vramMb <= 0) return model.gpuLayers;
  const totalLayers = (model.metadata?.blockCount ?? 0) + (model.metadata?.nextNPredictLayers ?? 0);
  if (totalLayers <= 0) return model.gpuLayers;

  const modelSizeMb = Math.floor(model.sizeBytes / (1024 * 1024));
  if (modelSizeMb <= 0) return model.gpuLayers;
  const kvCacheMb = calculateKvCache(model.contextSize, model.metadata, model.sizeBytes).kvCacheMb;
  const recommended = calculateMaxGpuLayers(totalLayers, modelSizeMb, kvCacheMb, hardware.vramMb);
  if (recommended >= totalLayers) return 999;
  return Math.max(0, recommended);
}

export function writeRouterPreset(config: RouterLaunchConfig, draftTokens: number): void {
  const lines: string[] = [
    `# llamacpp-launcher.models-max = ${config.modelsMax}`,
    `# llamacpp-launcher.models-autoload = ${config.autoload ? 'true' : 'false'}`,
    `# llamacpp-launcher.sleep-idle-seconds = ${config.sleepIdleSeconds}`,
    ...config.models.filter(model => !model.enabled).map(model => `# llamacpp-launcher.disabled-model = ${model.path}`),
    '',
    'version = 1',
    '',
    '[*]',
    'jinja = true',
  ];

  for (const model of config.models.filter(m => m.enabled)) {
    lines.push(
      '',
      `[${model.alias}]`,
      `model = ${model.path}`,
      `c = ${model.contextSize}`,
      `n-gpu-layers = ${model.gpuLayers}`,
      `np = ${model.parallelSlots}`,
      `load-on-startup = ${model.loadOnStartup ? 'true' : 'false'}`,
    );

    if (model.mtpEnabled) {
      lines.push(
        'spec-type = draft-mtp',
        `spec-draft-n-max = ${draftTokens}`,
      );
    }

    appendReasoningMode(lines, model.reasoningMode, model.rawArgs);
    appendModelParams(lines, model.params);
    appendRawArgs(lines, model.rawArgs);
  }

  writeFileSync(config.presetPath, `${lines.join('\n')}\n`, 'utf-8');
}
