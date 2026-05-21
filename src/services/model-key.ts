import type { ModelSelection } from '../types.js';

export function getModelKey(model: ModelSelection): string {
  if (model.mode === 'local') return model.path;
  if (model.mode === 'router') return model.presetPath;
  return model.file ? `${model.repo}/${model.file}` : model.repo;
}
