import type { ModelMetadata } from '../types.js';

export function detectMtp(metadata?: ModelMetadata, modelSource?: string, fileName?: string): boolean {
  if (metadata?.nextNPredictLayers && metadata.nextNPredictLayers > 0) {
    return true;
  }
  const combined = ((modelSource ?? '') + (fileName ?? '')).toLowerCase();
  return combined.includes('mtp');
}
