import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { LocalModel } from '../types.js';

function walkForGguf(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.gguf')) {
        const lower = entry.name.toLowerCase();
        if (!lower.startsWith('mmproj')) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

function parseRepoId(dirName: string): string | null {
  if (!dirName.startsWith('models--')) return null;
  const parts = dirName.slice('models--'.length).split('--');
  if (parts.length >= 2) {
    return parts.slice(0, 2).join('/');
  }
  return null;
}

export async function scanLocalModels(hfCachePath: string): Promise<LocalModel[]> {
  if (!existsSync(hfCachePath)) return [];

  const models: LocalModel[] = [];

  let entries;
  try {
    entries = readdirSync(hfCachePath, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoId = parseRepoId(entry.name);
    if (!repoId) continue;

    const repoDir = join(hfCachePath, entry.name);
    const ggufFiles = walkForGguf(repoDir);

    for (const filePath of ggufFiles) {
      models.push({
        path: filePath,
        fileName: basename(filePath),
        repoId,
      });
    }
  }

  return models;
}
