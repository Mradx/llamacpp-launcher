import test from 'node:test';
import assert from 'node:assert/strict';
import { NeedMoreDataError, parseGgufMetadata } from '../dist/services/gguf.js';

const TYPE = {
  UINT32: 4,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
};

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function f32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(value);
  return buffer;
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function str(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u64(bytes.length), bytes]);
}

function metadataEntry(key, type, value) {
  let body;
  if (type === TYPE.STRING) body = str(value);
  else if (type === TYPE.UINT32) body = u32(value);
  else if (type === TYPE.FLOAT32) body = f32(value);
  else if (type === TYPE.BOOL) body = Buffer.from([value ? 1 : 0]);
  else if (type === TYPE.UINT64) body = u64(value);
  else throw new Error(`Unsupported test type ${type}`);
  return Buffer.concat([str(key), u32(type), body]);
}

function arrayEntry(key, itemType, values) {
  const items = values.map(value => {
    if (itemType === TYPE.UINT32) return u32(value);
    if (itemType === TYPE.BOOL) return Buffer.from([value ? 1 : 0]);
    if (itemType === TYPE.STRING) return str(value);
    throw new Error(`Unsupported test array type ${itemType}`);
  });
  return Buffer.concat([
    str(key),
    u32(TYPE.ARRAY),
    u32(itemType),
    u64(values.length),
    ...items,
  ]);
}

function tensorInfo(name, type) {
  return Buffer.concat([
    str(name),
    u32(1),
    u64(1),
    u32(type),
    u64(0),
  ]);
}

function buildGguf() {
  const metadata = [
    metadataEntry('general.architecture', TYPE.STRING, 'llama'),
    metadataEntry('general.name', TYPE.STRING, 'Test Model'),
    metadataEntry('llama.block_count', TYPE.UINT32, 2),
    metadataEntry('llama.context_length', TYPE.UINT32, 4096),
    metadataEntry('llama.embedding_length', TYPE.UINT32, 128),
    metadataEntry('llama.rope.dimension_count', TYPE.UINT64, 64),
    metadataEntry('llama.attention.head_count', TYPE.UINT32, 8),
    arrayEntry('llama.attention.head_count_kv', TYPE.UINT32, [2, 4]),
    arrayEntry('tokenizer.ggml.tokens', TYPE.STRING, ['<s>', '</s>', 'hello']),
    metadataEntry('llama.rope.freq_base', TYPE.FLOAT32, 10000),
    metadataEntry('tokenizer.ggml.model', TYPE.STRING, 'llama'),
    metadataEntry('tokenizer.ggml.bos_token_id', TYPE.UINT32, 1),
    metadataEntry('tokenizer.ggml.eos_token_id', TYPE.UINT32, 2),
    metadataEntry('general.test_bool', TYPE.BOOL, true),
  ];
  const tensors = [
    tensorInfo('blk.0.attn_q.weight', 12),
    tensorInfo('blk.0.attn_k.weight', 12),
    tensorInfo('output.weight', 0),
  ];
  return Buffer.concat([
    Buffer.from('GGUF', 'ascii'),
    u32(3),
    u64(tensors.length),
    u64(metadata.length),
    ...metadata,
    ...tensors,
  ]);
}

test('parses scalar metadata, small arrays, and tensor quant types', () => {
  const metadata = parseGgufMetadata(buildGguf(), 'local');
  assert.equal(metadata.architecture, 'llama');
  assert.equal(metadata.name, 'Test Model');
  assert.equal(metadata.blockCount, 2);
  assert.equal(metadata.contextLength, 4096);
  assert.equal(metadata.embeddingLength, 128);
  assert.equal(metadata.ropeDimensionCount, 64);
  assert.equal(metadata.attentionHeadCount, 8);
  assert.equal(metadata.attentionHeadCountKv, 3);
  assert.deepEqual(metadata.attentionHeadCountKvByLayer, [2, 4]);
  assert.equal(metadata.tokenizerModel, 'llama');
  assert.equal(metadata.bosTokenId, 1);
  assert.equal(metadata.eosTokenId, 2);
  assert.equal(metadata.primaryQuantType, 'Q4_K');
  assert.deepEqual(metadata.quantTypes, { Q4_K: 2, F32: 1 });
});

test('throws NeedMoreDataError for incomplete metadata/tensor buffers', () => {
  assert.throws(() => parseGgufMetadata(buildGguf().subarray(0, 32), 'local'), NeedMoreDataError);
});
