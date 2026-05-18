import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelSelection } from '../types.js';

const OVERRIDES_FILE = 'template-overrides.json';

type OverridesData = Record<string, string>;

function getFilePath(): string {
  return join(process.cwd(), OVERRIDES_FILE);
}

export function getModelKey(model: ModelSelection): string {
  if (model.mode === 'local') return model.path;
  return model.file ? `${model.repo}/${model.file}` : model.repo;
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
