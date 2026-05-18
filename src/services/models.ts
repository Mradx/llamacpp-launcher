import { readdirSync, statSync, existsSync, lstatSync, readlinkSync, unlinkSync, rmSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import type { LocalModel } from '../types.js';
import { readGgufMetadata } from './gguf.js';

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
      let sizeBytes = 0;
      let metadata;
      try { sizeBytes = statSync(filePath).size; } catch {}
      try { metadata = readGgufMetadata(filePath) ?? undefined; } catch {}
      models.push({
        path: filePath,
        fileName: basename(filePath),
        repoId,
        sizeBytes,
        metadata,
      });
    }
  }

  return models;
}

export function getSiblingModels(model: LocalModel, allModels: LocalModel[]): LocalModel[] {
  return allModels.filter(m => m.repoId === model.repoId && m.path !== model.path);
}

function findRepoDir(modelPath: string): string | null {
  let dir = dirname(modelPath);
  while (dir && dir !== dirname(dir)) {
    if (basename(dir).startsWith('models--')) return dir;
    dir = dirname(dir);
  }
  return null;
}

export function deleteLocalModel(modelPath: string): { freedBytes: number } {
  const freedBytes = statSync(modelPath).size;

  if (lstatSync(modelPath).isSymbolicLink()) {
    const linkTarget = readlinkSync(modelPath);
    const blobPath = resolve(dirname(modelPath), linkTarget);

    unlinkSync(modelPath);

    if (existsSync(blobPath)) {
      const repoDir = findRepoDir(modelPath);
      let blobStillReferenced = false;

      if (repoDir) {
        const remainingFiles = walkForGguf(repoDir);
        for (const f of remainingFiles) {
          try {
            if (lstatSync(f).isSymbolicLink()) {
              const target = resolve(dirname(f), readlinkSync(f));
              if (target === blobPath) { blobStillReferenced = true; break; }
            }
          } catch {}
        }
      }

      if (!blobStillReferenced) {
        unlinkSync(blobPath);
      }
    }
  } else {
    unlinkSync(modelPath);
  }

  const repoDir = findRepoDir(modelPath);
  if (repoDir && walkForGguf(repoDir).length === 0) {
    rmSync(repoDir, { recursive: true, force: true });
  }

  return { freedBytes };
}
