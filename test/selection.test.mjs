import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowQuantPickerForContext } from '../dist/selection.js';

test('HF repos without a selected file go to quant picker after context selection', () => {
  const model = { mode: 'hf', repo: 'org/model', label: 'model' };
  assert.equal(shouldShowQuantPickerForContext(model, 4096), true);
});

test('changing context after choosing a quant asks for quantization again', () => {
  const model = { mode: 'hf', repo: 'org/model', file: 'model-UD-IQ4_NL.gguf', label: 'model' };
  assert.equal(shouldShowQuantPickerForContext(model, 64000, 4096), true);
});

test('keeping the same context after choosing a quant can continue forward', () => {
  const model = { mode: 'hf', repo: 'org/model', file: 'model-UD-IQ4_NL.gguf', label: 'model' };
  assert.equal(shouldShowQuantPickerForContext(model, 4096, 4096), false);
});

test('direct HF file selections keep their exact file when context changes', () => {
  const model = { mode: 'hf', repo: 'org/model', file: 'model-UD-IQ4_NL.gguf', label: 'model' };
  assert.equal(shouldShowQuantPickerForContext(model, 64000), false);
});

test('local models do not use the HF quant picker', () => {
  const model = { mode: 'local', path: '/models/model.gguf', label: 'model' };
  assert.equal(shouldShowQuantPickerForContext(model, 64000), false);
});
