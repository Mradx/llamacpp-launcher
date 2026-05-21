import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveQuickLaunchPreference,
  resolveSamplingLaunch,
  shouldShowQuantPickerForContext,
} from '../dist/selection.js';

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

test('quick launch uses an exact saved launch snapshot when available', () => {
  const lastLaunch = {
    contextSize: 8192,
    gpuLayers: 42,
    params: { temp: 0.2 },
    rawArgs: [],
    reasoningMode: 'off',
  };

  assert.deepEqual(
    resolveQuickLaunchPreference(
      {
        contextSize: 4096,
        sampling: { type: 'defaults' },
        reasoningMode: 'auto',
        lastLaunch,
      },
      [],
      64000,
    ),
    lastLaunch,
  );
});

test('quick launch can migrate completed legacy model preferences', () => {
  assert.deepEqual(
    resolveQuickLaunchPreference(
      {
        contextSize: 32768,
        gpuLayers: { type: 'custom', layers: 12 },
        sampling: { type: 'expert', rawArgs: ['--min-p', '0.02'] },
        reasoningMode: 'on',
      },
      [],
      64000,
    ),
    {
      contextSize: 32768,
      gpuLayers: 12,
      params: null,
      rawArgs: ['--min-p', '0.02'],
      reasoningMode: 'on',
    },
  );
});

test('quick launch ignores incomplete legacy preferences', () => {
  assert.equal(
    resolveQuickLaunchPreference(
      {
        contextSize: 32768,
        sampling: { type: 'defaults' },
      },
      [],
      64000,
    ),
    null,
  );
});

test('profile sampling resolves to the profile params for quick launch', () => {
  assert.deepEqual(
    resolveSamplingLaunch(
      { type: 'profile', profileName: 'Balanced' },
      [{ name: 'Balanced', params: { temp: 0.6, top_p: 0.9 } }],
    ),
    { params: { temp: 0.6, top_p: 0.9 }, rawArgs: [] },
  );

  assert.equal(
    resolveSamplingLaunch({ type: 'profile', profileName: 'Missing' }, []),
    null,
  );
});
