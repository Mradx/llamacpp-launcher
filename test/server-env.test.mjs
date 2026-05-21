import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServerEnvOverrides } from '../dist/services/server.js';

const baseConfig = {
  llamaCppDir: '/llama.cpp',
  hfCachePath: '/hf',
  host: '0.0.0.0',
  port: 8484,
  parallelSlots: 1,
  draftTokens: 2,
  contextOptions: [4096, 20000],
  serverDir: '/llama.cpp/build/bin',
  serverExe: 'llama-server',
};

test('does not set CUDA PDL env in default mode', () => {
  assert.deepEqual(buildServerEnvOverrides({
    ...baseConfig,
    cudaPdl: 'default',
  }), {});
});

test('sets CUDA PDL env override when requested', () => {
  assert.deepEqual(buildServerEnvOverrides({
    ...baseConfig,
    cudaPdl: 'on',
  }), { GGML_CUDA_PDL: '1' });

  assert.deepEqual(buildServerEnvOverrides({
    ...baseConfig,
    cudaPdl: 'off',
  }), { GGML_CUDA_PDL: '0' });
});
