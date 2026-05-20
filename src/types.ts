export interface StoredConfig {
  llamaCppDir: string;
  hfCachePath: string;
  host: string;
  port: number;
  parallelSlots: number;
  draftTokens: number;
  contextOptions: number[];
}

export type Config = StoredConfig & {
  serverDir: string;
  serverExe: string;
};

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

export interface ModelMetadata {
  architecture?: string;
  name?: string;
  baseName?: string;
  sizeLabel?: string;
  license?: string;
  blockCount?: number;
  contextLength?: number;
  embeddingLength?: number;
  feedForwardLength?: number;
  attentionHeadCount?: number;
  attentionHeadCountKv?: number;
  attentionHeadCountKvByLayer?: number[];
  nextNPredictLayers?: number;
  ropeFreqBase?: number;
  ropeDimensionCount?: number;
  tokenizerModel?: string;
  chatTemplate?: string;
  bosTokenId?: number;
  eosTokenId?: number;
  quantTypes?: Record<string, number>;
  primaryQuantType?: string;
  metadataSource: 'local' | 'hf' | 'estimated';
  isEstimated: boolean;
}

export interface LocalModel {
  path: string;
  fileName: string;
  repoId: string;
  sizeBytes: number;
  metadata?: ModelMetadata;
}

export interface HfFile {
  path: string;
  sizeBytes: number;
  sizeGb: number;
  downloaded?: boolean;
  metadata?: ModelMetadata;
  kvCacheMb: number;
  totalNeededMb: number;
  fitStatus: FitStatus;
  fitEstimated: boolean;
}

export type FitStatus = 'GPU_OK' | 'PARTIAL' | 'RAM_OK' | 'TOO_BIG';

export type ModelSelection =
  | { mode: 'local'; path: string; label: string; metadata?: ModelMetadata }
  | { mode: 'hf'; repo: string; file?: string; label: string; metadata?: ModelMetadata };

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
  metadata?: ModelMetadata;
  contextSize: number;
  gpuLayers: number;
  mtpEnabled: boolean;
  params: ModelParams | null;
  rawArgs: string[];
  chatTemplateOverride?: string;
}

export type Screen = 'model-select' | 'context-select' | 'quant-picker' | 'layer-select' | 'params-select' | 'custom-params' | 'expert-params' | 'chat-template';
