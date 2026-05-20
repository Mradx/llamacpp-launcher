import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFit, calculateKvCache, estimateModelMetadata } from '../dist/services/memory.js';

test('uses real metadata layers and GQA shape for KV cache', () => {
  const metadata = {
    blockCount: 60,
    embeddingLength: 5376,
    attentionHeadCount: 32,
    attentionHeadCountKv: 16,
    metadataSource: 'local',
    isEstimated: false,
  };
  const kv = calculateKvCache(64000, metadata, 18 * 1024 ** 3);
  const expected = Math.floor((64000 * 60 * 16 * (5376 / 32) * 2 * 2) / (1024 * 1024));
  assert.equal(kv.totalLayers, 60);
  assert.equal(kv.kvCacheMb, expected);
  assert.equal(kv.isEstimated, true);
});

test('falls back to size heuristic and marks estimates when metadata is absent', () => {
  const fileSize = 17.5 * 1024 ** 3;
  const metadata = estimateModelMetadata(fileSize);
  const fit = calculateFit(fileSize, 64000, 31800, 125600);
  assert.equal(metadata.blockCount, 40);
  assert.equal(fit.totalLayers, 40);
  assert.equal(fit.metadata.isEstimated, true);
  assert.equal(fit.isEstimated, true);
});

test('unified memory treats one pool and does not sum VRAM + RAM', () => {
  const ramMb = 32000;
  const vramMb = 24000; // Metal working-set budget (~0.75 of RAM)
  const gb = n => n * 1024 ** 3;

  // Fully Metal-resident.
  assert.equal(calculateFit(gb(16), 4096, vramMb, ramMb, undefined, true).fitStatus, 'GPU_OK');
  // Exceeds the GPU budget but fits the unified pool.
  assert.equal(calculateFit(gb(24), 4096, vramMb, ramMb, undefined, true).fitStatus, 'PARTIAL');
  // Exceeds the unified pool entirely.
  assert.equal(calculateFit(gb(28), 4096, vramMb, ramMb, undefined, true).fitStatus, 'TOO_BIG');

  // The same large model is PARTIAL under the discrete (summed-pool) model;
  // the unified path must not double-count VRAM + RAM.
  assert.equal(calculateFit(gb(28), 4096, vramMb, ramMb, undefined, false).fitStatus, 'PARTIAL');
});
