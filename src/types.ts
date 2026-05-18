export interface Config {
  serverDir: string;
  serverExe: string;
  hfCachePath: string;
  host: string;
  port: number;
  defaultContext: number;
  gpuLayers: number;
  parallelSlots: number;
  draftTokens: number;
  contextOptions: number[];
}

export interface HardwareInfo {
  gpuName: string;
  cpuName: string;
  vramMb: number;
  ramMb: number;
}

export interface NetworkInfo {
  lanIp: string | null;
  lanUrl: string | null;
  localUrl: string;
}

export interface LocalModel {
  path: string;
  fileName: string;
  repoId: string;
  sizeBytes: number;
}

export interface HfFile {
  path: string;
  sizeBytes: number;
  sizeGb: number;
  estimatedLayers: number;
  totalLayers: number;
  kvCacheMb: number;
  totalNeededMb: number;
  fitStatus: FitStatus;
}

export type FitStatus = 'GPU_OK' | 'PARTIAL' | 'RAM_OK' | 'TOO_BIG';

export type ModelSelection =
  | { mode: 'local'; path: string; label: string }
  | { mode: 'hf'; repo: string; file?: string; label: string };

export interface ModelParams {
  temp?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  repeat_penalty?: number;
  top_n_sigma?: number;
  dynatemp_range?: number;
  mirostat?: number;
  mirostat_tau?: number;
  mirostat_eta?: number;
}

export interface ParamsProfile {
  name: string;
  params: ModelParams;
}

export interface ModelPreset {
  match: string[];
  name: string;
  profiles: ParamsProfile[];
}

export interface FullSelection {
  model: ModelSelection;
  contextSize: number;
  gpuLayers: number;
  mtpEnabled: boolean;
  params: ModelParams | null;
  rawArgs: string[];
}

export type Screen = 'model-select' | 'context-select' | 'quant-picker' | 'layer-select' | 'params-select' | 'custom-params' | 'expert-params';
