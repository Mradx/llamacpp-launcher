import type { FitStatus } from '../types.js';

export function estimateLayers(sizeGb: number): number {
  if (sizeGb < 5) return 28;
  if (sizeGb < 10) return 32;
  if (sizeGb < 20) return 40;
  if (sizeGb < 35) return 48;
  if (sizeGb < 60) return 64;
  return 80;
}

export interface FitResult {
  estimatedLayers: number;
  kvCacheMb: number;
  totalNeededMb: number;
  fitStatus: FitStatus;
}

export function calculateKvCacheMb(contextTokens: number, layers: number): number {
  const kvBytesPerToken = 4096 * layers;
  return Math.floor((contextTokens * kvBytesPerToken) / (1024 * 1024));
}

export interface LayerSplit {
  gpuLayers: number;
  totalLayers: number;
  gpuModelMb: number;
  gpuKvMb: number;
  gpuTotalMb: number;
  cpuModelMb: number;
  cpuKvMb: number;
  cpuTotalMb: number;
}

export function calculateLayerSplit(
  totalLayers: number,
  modelSizeMb: number,
  kvCacheMb: number,
  gpuLayers: number
): LayerSplit {
  const clamped = Math.min(Math.max(0, gpuLayers), totalLayers);
  const perLayerMb = modelSizeMb / totalLayers;
  const gpuModelMb = Math.round(clamped * perLayerMb);
  const gpuKvMb = clamped > 0 ? kvCacheMb : 0;
  const cpuModelMb = Math.round((totalLayers - clamped) * perLayerMb);
  const cpuKvMb = clamped === 0 ? kvCacheMb : 0;

  return {
    gpuLayers: clamped,
    totalLayers,
    gpuModelMb,
    gpuKvMb,
    gpuTotalMb: gpuModelMb + gpuKvMb,
    cpuModelMb,
    cpuKvMb,
    cpuTotalMb: cpuModelMb + cpuKvMb,
  };
}

export function calculateMaxGpuLayers(
  totalLayers: number,
  modelSizeMb: number,
  kvCacheMb: number,
  vramMb: number
): number {
  const overhead = 500;
  const available = vramMb * 0.95 - overhead - kvCacheMb;
  if (available <= 0) return 0;
  const perLayerMb = modelSizeMb / totalLayers;
  return Math.min(totalLayers, Math.floor(available / perLayerMb));
}

export function calculateFit(
  fileSizeBytes: number,
  contextTokens: number,
  vramMb: number,
  ramMb: number
): FitResult {
  const sizeGb = fileSizeBytes / (1024 ** 3);
  const sizeMb = Math.floor(fileSizeBytes / (1024 * 1024));
  const layers = estimateLayers(sizeGb);

  const kvBytesPerToken = 4096 * layers;
  const kvMb = Math.floor((contextTokens * kvBytesPerToken) / (1024 * 1024));
  const totalNeededMb = sizeMb + kvMb + 1500;

  const vramAvail = Math.floor(vramMb * 0.95);
  const ramAvail = Math.floor(ramMb * 0.70);

  let fitStatus: FitStatus;
  if (totalNeededMb <= vramAvail) {
    fitStatus = 'GPU_OK';
  } else if (totalNeededMb <= vramAvail + ramAvail) {
    fitStatus = 'PARTIAL';
  } else if (totalNeededMb <= ramMb) {
    fitStatus = 'RAM_OK';
  } else {
    fitStatus = 'TOO_BIG';
  }

  return { estimatedLayers: layers, kvCacheMb: kvMb, totalNeededMb, fitStatus };
}
