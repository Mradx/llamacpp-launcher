import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelPreset, ParamsProfile } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');

interface PresetsFile {
  presets: ModelPreset[];
}

let cached: ModelPreset[] | null = null;

export function loadPresets(): ModelPreset[] {
  if (cached) return cached;

  const presetsPath = resolve(projectRoot, 'presets.json');
  if (!existsSync(presetsPath)) return [];

  try {
    const data = JSON.parse(readFileSync(presetsPath, 'utf-8')) as PresetsFile;
    cached = data.presets || [];
    return cached;
  } catch {
    return [];
  }
}

export function findPreset(modelIdentifier: string): ModelPreset | null {
  const presets = loadPresets();
  const lower = modelIdentifier.toLowerCase();

  for (const preset of presets) {
    for (const pattern of preset.match) {
      if (lower.includes(pattern.toLowerCase())) {
        return preset;
      }
    }
  }

  return null;
}

export function getProfiles(modelIdentifier: string): ParamsProfile[] {
  const preset = findPreset(modelIdentifier);
  return preset?.profiles || [];
}
