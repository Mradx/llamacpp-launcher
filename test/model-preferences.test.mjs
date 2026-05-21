import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveContextPreferenceIndex,
  resolveGpuLayerPreferenceIndex,
  resolveSamplingPreferenceIndex,
} from '../dist/services/model-preferences.js';

test('context preference resolves only when the option still exists', () => {
  assert.equal(resolveContextPreferenceIndex([4096, 20000, 64000], 20000), 1);
  assert.equal(resolveContextPreferenceIndex([4096, 64000], 20000), undefined);
});

test('gpu layer preference falls back when preset layers disappear', () => {
  const choices = [
    { layers: 999 },
    { layers: 24 },
    { layers: 0 },
  ];

  assert.equal(resolveGpuLayerPreferenceIndex(choices, { type: 'preset', layers: 24 }, 3), 1);
  assert.equal(resolveGpuLayerPreferenceIndex(choices, { type: 'preset', layers: 12 }, 3), undefined);
});

test('custom gpu layer preference points at the custom item', () => {
  assert.equal(resolveGpuLayerPreferenceIndex([{ layers: 999 }], { type: 'custom', layers: 12 }, 1), 1);
});

test('sampling preference resolves by semantic choice instead of index', () => {
  const choices = [
    { preference: { type: 'profile', profileName: 'Creative' } },
    { preference: { type: 'custom', params: { temp: 0.4, top_k: 20 } } },
    { preference: { type: 'expert', rawArgs: ['--min-p', '0.02'] } },
    { preference: { type: 'defaults' } },
  ];

  assert.equal(resolveSamplingPreferenceIndex(choices, { type: 'profile', profileName: 'Creative' }), 0);
  assert.equal(resolveSamplingPreferenceIndex(choices, { type: 'custom', params: { temp: 0.4, top_k: 20 } }), 1);
  assert.equal(resolveSamplingPreferenceIndex(choices, { type: 'expert', rawArgs: ['--min-p', '0.02'] }), 2);
  assert.equal(resolveSamplingPreferenceIndex(choices, { type: 'defaults' }), 3);
  assert.equal(resolveSamplingPreferenceIndex(choices, { type: 'profile', profileName: 'Balanced' }), undefined);
});
