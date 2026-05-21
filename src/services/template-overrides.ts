import { readFileSync, writeFileSync } from 'node:fs';
import type { ModelSelection } from '../types.js';
import { getDataPath } from '../storage.js';
import { getModelKey } from './model-key.js';

const OVERRIDES_FILE = 'template-overrides.json';

type OverridesData = Record<string, string>;

function getFilePath(): string {
  return getDataPath(OVERRIDES_FILE);
}

function loadAll(): OverridesData {
  try {
    return JSON.parse(readFileSync(getFilePath(), 'utf-8'));
  } catch {
    return {};
  }
}

export function loadTemplateOverride(model: ModelSelection): string | undefined {
  return loadAll()[getModelKey(model)];
}

export function saveTemplateOverride(model: ModelSelection, template: string | undefined): void {
  const data = loadAll();
  const key = getModelKey(model);
  if (template === undefined) {
    delete data[key];
  } else {
    data[key] = template;
  }
  writeFileSync(getFilePath(), JSON.stringify(data, null, 2), 'utf-8');
}
