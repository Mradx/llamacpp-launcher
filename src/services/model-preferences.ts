import { readFileSync, writeFileSync } from 'node:fs';
import type { ModelParams, ModelSelection, ReasoningMode } from '../types.js';
import { getDataPath } from '../storage.js';
import { getModelKey } from './model-key.js';

const PREFERENCES_FILE = 'model-preferences.json';

export type GpuLayerPreference =
  | { type: 'preset'; layers: number }
  | { type: 'custom'; layers: number };

export type SamplingPreference =
  | { type: 'profile'; profileName: string }
  | { type: 'defaults' }
  | { type: 'custom'; params: ModelParams }
  | { type: 'expert'; rawArgs: string[] };

export interface ModelLaunchPreference {
  contextSize: number;
  gpuLayers: number;
  params: ModelParams | null;
  rawArgs: string[];
  reasoningMode: ReasoningMode;
  chatTemplateOverride?: string;
}

export interface ModelPreferences {
  contextSize?: number;
  gpuLayers?: GpuLayerPreference;
  sampling?: SamplingPreference;
  reasoningMode?: ReasoningMode;
  lastLaunch?: ModelLaunchPreference;
}

interface PreferencesData {
  models: Record<string, ModelPreferences>;
}

function getPreferencesPath(): string {
  return getDataPath(PREFERENCES_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isReasoningMode(value: unknown): value is ReasoningMode {
  return value === 'auto' || value === 'on' || value === 'off';
}

function normalizeParams(value: unknown): ModelParams | undefined {
  if (!isRecord(value)) return undefined;

  const params: ModelParams = {};
  const keys: Array<keyof ModelParams> = [
    'temp',
    'top_k',
    'top_p',
    'min_p',
    'presence_penalty',
    'frequency_penalty',
    'repeat_penalty',
    'top_n_sigma',
    'dynatemp_range',
    'mirostat',
    'mirostat_tau',
    'mirostat_eta',
  ];

  for (const key of keys) {
    const param = value[key];
    if (isFiniteNumber(param)) {
      params[key] = param;
    }
  }

  return params;
}

function normalizeGpuPreference(value: unknown): GpuLayerPreference | undefined {
  if (!isRecord(value)) return undefined;
  const type = value.type;
  const layers = value.layers;
  if ((type === 'preset' || type === 'custom') && isFiniteNumber(layers)) {
    return { type, layers };
  }
  return undefined;
}

function normalizeSamplingPreference(value: unknown): SamplingPreference | undefined {
  if (!isRecord(value)) return undefined;

  if (value.type === 'profile' && typeof value.profileName === 'string' && value.profileName) {
    return { type: 'profile', profileName: value.profileName };
  }
  if (value.type === 'defaults') {
    return { type: 'defaults' };
  }
  if (value.type === 'custom') {
    const params = normalizeParams(value.params);
    if (params) return { type: 'custom', params };
  }
  if (value.type === 'expert' && Array.isArray(value.rawArgs) && value.rawArgs.every(arg => typeof arg === 'string')) {
    return { type: 'expert', rawArgs: value.rawArgs };
  }

  return undefined;
}

function normalizeLaunchPreference(value: unknown): ModelLaunchPreference | undefined {
  if (!isRecord(value)) return undefined;

  const params = value.params === null ? null : normalizeParams(value.params);
  const rawArgs = Array.isArray(value.rawArgs) && value.rawArgs.every(arg => typeof arg === 'string')
    ? value.rawArgs
    : undefined;

  if (
    isFiniteNumber(value.contextSize) &&
    isFiniteNumber(value.gpuLayers) &&
    params !== undefined &&
    rawArgs &&
    isReasoningMode(value.reasoningMode)
  ) {
    const launch: ModelLaunchPreference = {
      contextSize: value.contextSize,
      gpuLayers: value.gpuLayers,
      params,
      rawArgs,
      reasoningMode: value.reasoningMode,
    };
    if (typeof value.chatTemplateOverride === 'string') {
      launch.chatTemplateOverride = value.chatTemplateOverride;
    }
    return launch;
  }

  return undefined;
}

function normalizeModelPreferences(value: unknown): ModelPreferences {
  if (!isRecord(value)) return {};

  const preferences: ModelPreferences = {};
  if (isFiniteNumber(value.contextSize)) {
    preferences.contextSize = value.contextSize;
  }

  const gpuLayers = normalizeGpuPreference(value.gpuLayers);
  if (gpuLayers) {
    preferences.gpuLayers = gpuLayers;
  }

  const sampling = normalizeSamplingPreference(value.sampling);
  if (sampling) {
    preferences.sampling = sampling;
  }

  if (isReasoningMode(value.reasoningMode)) {
    preferences.reasoningMode = value.reasoningMode;
  }

  const lastLaunch = normalizeLaunchPreference(value.lastLaunch);
  if (lastLaunch) {
    preferences.lastLaunch = lastLaunch;
  }

  return preferences;
}

function loadAll(): PreferencesData {
  try {
    const raw = JSON.parse(readFileSync(getPreferencesPath(), 'utf-8'));
    if (!isRecord(raw) || !isRecord(raw.models)) {
      return { models: {} };
    }

    const models: Record<string, ModelPreferences> = {};
    for (const [key, value] of Object.entries(raw.models)) {
      models[key] = normalizeModelPreferences(value);
    }
    return { models };
  } catch {
    return { models: {} };
  }
}

function saveAll(data: PreferencesData): void {
  writeFileSync(getPreferencesPath(), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function updateModelPreferences(model: ModelSelection, update: (preferences: ModelPreferences) => ModelPreferences): void {
  const data = loadAll();
  const key = getModelKey(model);
  data.models[key] = update(data.models[key] || {});
  saveAll(data);
}

export function loadModelPreferences(model: ModelSelection): ModelPreferences {
  return loadAll().models[getModelKey(model)] || {};
}

export function saveModelContextPreference(model: ModelSelection, contextSize: number): void {
  updateModelPreferences(model, preferences => ({ ...preferences, contextSize }));
}

export function saveModelGpuLayerPreference(model: ModelSelection, gpuLayers: GpuLayerPreference): void {
  updateModelPreferences(model, preferences => ({ ...preferences, gpuLayers }));
}

export function saveModelSamplingPreference(model: ModelSelection, sampling: SamplingPreference): void {
  updateModelPreferences(model, preferences => ({ ...preferences, sampling }));
}

export function saveModelReasoningPreference(model: ModelSelection, reasoningMode: ReasoningMode): void {
  updateModelPreferences(model, preferences => ({ ...preferences, reasoningMode }));
}

export function saveModelLaunchPreference(model: ModelSelection, lastLaunch: ModelLaunchPreference): void {
  updateModelPreferences(model, preferences => ({ ...preferences, lastLaunch }));
}

export function resolveContextPreferenceIndex(options: number[], contextSize?: number): number | undefined {
  if (contextSize === undefined) return undefined;
  const index = options.indexOf(contextSize);
  return index >= 0 ? index : undefined;
}

export function resolveGpuLayerPreferenceIndex(
  choices: Array<{ layers: number }>,
  preference?: GpuLayerPreference,
  customIndex?: number,
): number | undefined {
  if (!preference) return undefined;
  if (preference.type === 'custom') {
    return customIndex;
  }

  const index = choices.findIndex(choice => choice.layers === preference.layers);
  return index >= 0 ? index : undefined;
}

function paramsEqual(a: ModelParams, b: ModelParams): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function samplingPreferencesEqual(a: SamplingPreference, b: SamplingPreference): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'profile' && b.type === 'profile') return a.profileName === b.profileName;
  if (a.type === 'defaults' && b.type === 'defaults') return true;
  if (a.type === 'custom' && b.type === 'custom') return paramsEqual(a.params, b.params);
  if (a.type === 'expert' && b.type === 'expert') return stringArraysEqual(a.rawArgs, b.rawArgs);
  return false;
}

export function resolveSamplingPreferenceIndex(
  choices: Array<{ preference?: SamplingPreference }>,
  preference?: SamplingPreference,
): number | undefined {
  if (!preference) return undefined;
  const index = choices.findIndex(choice => (
    choice.preference ? samplingPreferencesEqual(choice.preference, preference) : false
  ));
  return index >= 0 ? index : undefined;
}
