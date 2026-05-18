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
}

export interface HfFile {
  path: string;
  sizeBytes: number;
  sizeGb: number;
  estimatedLayers: number;
  kvCacheMb: number;
  totalNeededMb: number;
  fitStatus: FitStatus;
}

export type FitStatus = 'GPU_OK' | 'PARTIAL' | 'RAM_OK' | 'TOO_BIG';

export type ModelSelection =
  | { mode: 'local'; path: string; label: string }
  | { mode: 'hf'; repo: string; file?: string; label: string };

export interface FullSelection {
  model: ModelSelection;
  contextSize: number;
  mtpEnabled: boolean;
}

export type Screen = 'model-select' | 'context-select' | 'quant-picker' | 'dashboard';

export interface AppState {
  screen: Screen;
  hardware: HardwareInfo | null;
  network: NetworkInfo | null;
  localModels: LocalModel[];
  selectedModel: ModelSelection | null;
  contextSize: number;
  serverStatus: 'idle' | 'starting' | 'running' | 'stopped' | 'error';
  error: string | null;
}
