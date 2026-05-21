import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServerArgs } from '../dist/services/server.js';
import {
  createRouterLaunchConfig,
  parseRouterPresetContent,
  writeRouterPreset,
} from '../dist/services/router-preset.js';

function routerConfig(presetPath) {
  return {
    presetPath,
    modelsMax: 1,
    autoload: true,
    sleepIdleSeconds: 300,
    models: [{
      alias: 'gemma-router',
      label: 'Gemma',
      path: '/models/gemma.gguf',
      fileName: 'gemma.gguf',
      repoId: 'local/gemma',
      sizeBytes: 4 * 1024 ** 3,
      enabled: true,
      contextSize: 20000,
      gpuLayers: 999,
      parallelSlots: 2,
      loadOnStartup: false,
      mtpEnabled: true,
      reasoningMode: 'off',
      params: {
        temp: 1,
        top_k: 64,
        top_p: 0.95,
        min_p: 0,
      },
      paramsLabel: 'Gemma 4: Default',
      rawArgs: ['--cache-type-k', 'q8_0', '--no-mmap'],
    }],
  };
}

test('router launch uses models preset instead of a single model arg', () => {
  const router = routerConfig('/tmp/models.ini');
  const args = buildServerArgs({
    llamaCppDir: '/llama.cpp',
    hfCachePath: '/hf',
    host: '0.0.0.0',
    port: 8787,
    parallelSlots: 1,
    draftTokens: 2,
    contextOptions: [4096, 20000],
    serverDir: '/llama.cpp/build/bin',
    serverExe: 'llama-server',
  }, {
    model: { mode: 'router', label: 'Multi-model router', presetPath: router.presetPath },
    contextSize: 0,
    gpuLayers: 0,
    mtpEnabled: false,
    reasoningMode: 'auto',
    params: null,
    rawArgs: [],
    router,
  });

  assert.deepEqual(args, [
    '--host', '0.0.0.0',
    '--port', '8787',
    '--models-preset', '/tmp/models.ini',
    '--models-max', '1',
    '--models-autoload',
    '--sleep-idle-seconds', '300',
  ]);
});

test('router preset writes per-model loading parameters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'llamacpp-router-'));
  const presetPath = join(dir, 'models.ini');
  writeRouterPreset(routerConfig(presetPath), 4);

  const content = readFileSync(presetPath, 'utf-8');
  assert.match(content, /\[gemma-router\]/);
  assert.match(content, /model = \/models\/gemma\.gguf/);
  assert.match(content, /c = 20000/);
  assert.match(content, /n-gpu-layers = 999/);
  assert.match(content, /np = 2/);
  assert.match(content, /spec-type = draft-mtp/);
  assert.match(content, /spec-draft-n-max = 4/);
  assert.match(content, /reasoning = off/);
  assert.match(content, /temp = 1/);
  assert.match(content, /top-k = 64/);
  assert.match(content, /top-p = 0.95/);
  assert.match(content, /min-p = 0/);
  assert.match(content, /cache-type-k = q8_0/);
  assert.match(content, /no-mmap = true/);
});

test('router preset parser restores saved per-model parameters', () => {
  const parsed = parseRouterPresetContent(`
    # llamacpp-launcher.models-max = 2
    # llamacpp-launcher.models-autoload = false
    # llamacpp-launcher.sleep-idle-seconds = 900
    # llamacpp-launcher.disabled-model = /models/disabled.gguf

    version = 1

    [saved-gemma]
    model = /models/gemma.gguf
    c = 32768
    n-gpu-layers = 24
    np = 3
    load-on-startup = true
    reasoning = on
    temp = 0.7
    top-k = 20
    cache-type-k = q8_0
    no-mmap = true
  `);

  const config = createRouterLaunchConfig([
    {
      path: '/models/gemma.gguf',
      fileName: 'gemma.gguf',
      repoId: 'local/gemma',
      sizeBytes: 4 * 1024 ** 3,
    },
    {
      path: '/models/disabled.gguf',
      fileName: 'disabled.gguf',
      repoId: 'local/disabled',
      sizeBytes: 2 * 1024 ** 3,
    },
  ], [4096, 20000], {
    llamaCppDir: '/llama.cpp',
    hfCachePath: '/hf',
    host: '0.0.0.0',
    port: 8787,
    parallelSlots: 1,
    draftTokens: 2,
    contextOptions: [4096, 20000],
    serverDir: '/llama.cpp/build/bin',
    serverExe: 'llama-server',
  }, parsed);

  assert.equal(config.modelsMax, 2);
  assert.equal(config.autoload, false);
  assert.equal(config.sleepIdleSeconds, 900);

  const gemma = config.models[0];
  assert.equal(gemma.alias, 'saved-gemma');
  assert.equal(gemma.enabled, true);
  assert.equal(gemma.contextSize, 32768);
  assert.equal(gemma.gpuLayers, 24);
  assert.equal(gemma.parallelSlots, 3);
  assert.equal(gemma.loadOnStartup, true);
  assert.equal(gemma.reasoningMode, 'on');
  assert.deepEqual(gemma.params, { temp: 0.7, top_k: 20 });
  assert.deepEqual(gemma.rawArgs, ['--cache-type-k', 'q8_0', '--no-mmap']);

  assert.equal(config.models[1].enabled, false);
});
