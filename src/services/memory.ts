import type { FitStatus, ModelMetadata } from '../types.js';

const DEFAULT_KV_BYTES_PER_ELEMENT = 2;

export function estimateLayers(sizeGb: number): number {
  if (sizeGb < 5) return 28;
  if (sizeGb < 10) return 32;
  if (sizeGb < 20) return 40;
  if (sizeGb < 35) return 48;
  if (sizeGb < 60) return 64;
  return 80;
}

export interface FitResult {
  totalLayers: number;
  kvCacheMb: number;
  kvCacheEstimated: boolean;
  totalNeededMb: number;
  fitStatus: FitStatus;
  metadata: ModelMetadata;
  isEstimated: boolean;
}

export interface KvCacheResult {
  totalLayers: number;
  kvCacheMb: number;
  isEstimated: boolean;
}

export function estimateModelMetadata(fileSizeBytes: number): ModelMetadata {
  return {
    blockCount: estimateLayers(fileSizeBytes / (1024 ** 3)),
    metadataSource: 'estimated',
    isEstimated: true,
  };
}

export function getEffectiveMetadata(metadata: ModelMetadata | undefined, fileSizeBytes: number): ModelMetadata {
  return metadata ?? estimateModelMetadata(fileSizeBytes);
}

export function calculateKvCache(contextTokens: number, metadata: ModelMetadata | undefined, fileSizeBytes: number): KvCacheResult {
  const effective = getEffectiveMetadata(metadata, fileSizeBytes);
  const layers = effective.blockCount ?? estimateLayers(fileSizeBytes / (1024 ** 3));
  const hasAttentionShape = !!(
    effective.embeddingLength &&
    effective.attentionHeadCount &&
    effective.attentionHeadCountKv
  );

  if (hasAttentionShape) {
    const headDim = effective.embeddingLength! / effective.attentionHeadCount!;
    let kvHeadLayerTotal = layers * effective.attentionHeadCountKv!;
    if (effective.attentionHeadCountKvByLayer?.length) {
      const layerHeadSum = effective.attentionHeadCountKvByLayer.reduce((sum, count) => sum + count, 0);
      kvHeadLayerTotal = effective.attentionHeadCountKvByLayer.length === layers
        ? layerHeadSum
        : (layerHeadSum / effective.attentionHeadCountKvByLayer.length) * layers;
    }
    const kvBytes = contextTokens
      * kvHeadLayerTotal
      * headDim
      * 2
      * DEFAULT_KV_BYTES_PER_ELEMENT;
    return {
      totalLayers: layers,
      kvCacheMb: Math.floor(kvBytes / (1024 * 1024)),
      isEstimated: true,
    };
  }

  const kvBytesPerToken = 4096 * layers;
  return {
    totalLayers: layers,
    kvCacheMb: Math.floor((contextTokens * kvBytesPerToken) / (1024 * 1024)),
    isEstimated: true,
  };
}

export function calculateKvCacheMb(contextTokens: number, metadata: ModelMetadata | undefined, fileSizeBytes: number): number {
  return calculateKvCache(contextTokens, metadata, fileSizeBytes).kvCacheMb;
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
  ramMb: number,
  metadata?: ModelMetadata,
  unified = false
): FitResult {
  const sizeMb = Math.floor(fileSizeBytes / (1024 * 1024));
  const effective = getEffectiveMetadata(metadata, fileSizeBytes);
  const kv = calculateKvCache(contextTokens, effective, fileSizeBytes);
  const layers = kv.totalLayers;
  const kvMb = kv.kvCacheMb;
  const totalNeededMb = sizeMb + kvMb + 1500;

  let fitStatus: FitStatus;
  if (unified) {
    // Apple Silicon: GPU and CPU share one memory pool. vramMb is the Metal
    // working-set budget, so summing it with RAM (as the discrete path does)
    // would double-count the same memory.
    const gpuBudget = vramMb;
    const ramAvail = Math.floor(ramMb * 0.90);
    if (totalNeededMb <= gpuBudget) {
      fitStatus = 'GPU_OK';
    } else if (totalNeededMb <= ramAvail) {
      fitStatus = 'PARTIAL';
    } else {
      fitStatus = 'TOO_BIG';
    }
  } else {
    const vramAvail = Math.floor(vramMb * 0.95);
    const ramAvail = Math.floor(ramMb * 0.70);
    if (totalNeededMb <= vramAvail) {
      fitStatus = 'GPU_OK';
    } else if (totalNeededMb <= vramAvail + ramAvail) {
      fitStatus = 'PARTIAL';
    } else if (totalNeededMb <= ramMb) {
      fitStatus = 'RAM_OK';
    } else {
      fitStatus = 'TOO_BIG';
    }
  }

  return {
    totalLayers: layers,
    kvCacheMb: kvMb,
    kvCacheEstimated: kv.isEstimated,
    totalNeededMb,
    fitStatus,
    metadata: effective,
    isEstimated: effective.isEstimated || kv.isEstimated,
  };
}
