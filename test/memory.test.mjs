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
