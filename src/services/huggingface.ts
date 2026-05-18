import type { HfFile, ModelMetadata } from '../types.js';
import { calculateFit } from './memory.js';
import { fetchGgufMetadata } from './gguf.js';

interface HfTreeEntry {
  type: string;
  path: string;
  size: number;
}

const SPLIT_PATTERN = /-\d{5}-of-\d{5}$/;

function extractQuantFromPath(path: string): string | undefined {
  const fileName = path.split('/').pop() || path;
  const base = fileName.replace(/\.gguf$/i, '').replace(SPLIT_PATTERN, '');
  const match = base.match(/[-_]((?:UD[-_])?(?:I?Q\d[-_\w]*|[BF]F?\d+\w*|Q\d[-_\w]*))$/i);
  return match?.[1]?.replace(/-/g, '_');
}

function groupSplitFiles(files: HfTreeEntry[]): HfTreeEntry[] {
  const groups = new Map<string, HfTreeEntry[]>();
  const singles: HfTreeEntry[] = [];

  for (const file of files) {
    const base = file.path.replace(/\.gguf$/i, '');
    if (SPLIT_PATTERN.test(base)) {
      const groupKey = base.replace(SPLIT_PATTERN, '');
      const group = groups.get(groupKey) || [];
      group.push(file);
      groups.set(groupKey, group);
    } else {
      singles.push(file);
    }
  }

  const result: HfTreeEntry[] = [...singles];
  for (const [, parts] of groups) {
    parts.sort((a, b) => {
      const aNum = parseInt(a.path.replace(/\.gguf$/i, '').match(SPLIT_PATTERN)![0].slice(1, 6));
      const bNum = parseInt(b.path.replace(/\.gguf$/i, '').match(SPLIT_PATTERN)![0].slice(1, 6));
      return aNum - bNum;
    });
    result.push({
      type: 'file',
      path: parts[0].path,
      size: parts.reduce((sum, p) => sum + p.size, 0),
    });
  }

  return result;
}

function metadataForFile(baseMetadata: ModelMetadata | null, filePath: string): ModelMetadata | undefined {
  const primaryQuantType = extractQuantFromPath(filePath);
  if (baseMetadata) {
    return {
      ...baseMetadata,
      quantTypes: undefined,
      primaryQuantType: primaryQuantType ?? baseMetadata.primaryQuantType,
    };
  }
  if (!primaryQuantType) return undefined;
  return {
    primaryQuantType,
    metadataSource: 'estimated',
    isEstimated: true,
  };
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

  const grouped = groupSplitFiles(ggufFiles);
  grouped.sort((a, b) => a.size - b.size);

  const metadata = grouped.length > 0
    ? await fetchGgufMetadata(repo, grouped[0].path).catch(() => null)
    : null;
  return grouped.map(entry => {
    const fileMetadata = metadataForFile(metadata, entry.path);
    const fit = calculateFit(entry.size, contextTokens, vramMb, ramMb, fileMetadata);
    return {
      path: entry.path,
      sizeBytes: entry.size,
      sizeGb: parseFloat((entry.size / (1024 ** 3)).toFixed(1)),
      metadata: fileMetadata,
      kvCacheMb: fit.kvCacheMb,
      totalNeededMb: fit.totalNeededMb,
      fitStatus: fit.fitStatus,
      fitEstimated: fit.isEstimated,
    };
  });
}
