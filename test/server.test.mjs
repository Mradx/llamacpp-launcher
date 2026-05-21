import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServerArgs } from '../dist/services/server.js';

function config() {
  return {
    llamaCppDir: '/llama.cpp',
    hfCachePath: '/hf',
    host: '127.0.0.1',
    port: 8484,
    parallelSlots: 1,
    draftTokens: 2,
    cudaPdl: 'default',
    contextOptions: [4096, 20000],
    serverDir: '/llama.cpp/build/bin',
    serverExe: 'llama-server',
  };
}

function selection(overrides = {}) {
  return {
    model: { mode: 'local', path: '/models/qwen.gguf', label: 'Qwen' },
    contextSize: 4096,
    gpuLayers: 999,
    mtpEnabled: false,
    reasoningMode: 'auto',
    params: null,
    rawArgs: [],
    ...overrides,
  };
}

test('single-model launch emits explicit reasoning modes', () => {
  const args = buildServerArgs(config(), selection({ reasoningMode: 'on' }));

  assert.equal(args.includes('--reasoning'), true);
  assert.deepEqual(args.slice(args.indexOf('--reasoning'), args.indexOf('--reasoning') + 2), [
    '--reasoning',
    'on',
  ]);
});

test('auto reasoning uses llama.cpp default without forcing a new flag', () => {
  const args = buildServerArgs(config(), selection({ reasoningMode: 'auto' }));

  assert.equal(args.includes('--reasoning'), false);
});

test('expert reasoning arg is not duplicated by the structured setting', () => {
  const args = buildServerArgs(config(), selection({
    reasoningMode: 'off',
    rawArgs: ['--reasoning', 'on'],
  }));

  assert.equal(args.filter(arg => arg === '--reasoning').length, 1);
});
