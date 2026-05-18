import type { HfFile } from '../types.js';
import { calculateFit } from './memory.js';

interface HfTreeEntry {
  type: string;
  path: string;
  size: number;
}

export async function listGgufFiles(
  repo: string,
  contextTokens: number,
  vramMb: number,
  ramMb: number
): Promise<HfFile[]> {
  const url = `https://huggingface.co/api/models/${repo}/tree/main?recursive=true`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'llamacpp-launcher/1.0' },
  });

  if (!response.ok) {
    throw new Error(`HuggingFace API error: ${response.status} ${response.statusText}`);
  }

  const entries: HfTreeEntry[] = await response.json();

  const ggufFiles = entries.filter(entry => {
    if (entry.type !== 'file') return false;
    if (!entry.path.endsWith('.gguf')) return false;
    const lower = entry.path.toLowerCase();
    if (lower.includes('mmproj')) return false;
    if (lower.includes('imatrix')) return false;
    return true;
  });

  ggufFiles.sort((a, b) => a.size - b.size);

  return ggufFiles.map(entry => {
    const fit = calculateFit(entry.size, contextTokens, vramMb, ramMb);
    return {
      path: entry.path,
      sizeBytes: entry.size,
      sizeGb: parseFloat((entry.size / (1024 ** 3)).toFixed(1)),
      estimatedLayers: fit.estimatedLayers,
      kvCacheMb: fit.kvCacheMb,
      totalNeededMb: fit.totalNeededMb,
      fitStatus: fit.fitStatus,
    };
  });
}
