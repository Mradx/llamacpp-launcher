import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { ModelMetadata } from '../types.js';

const GGUF_MAGIC = 'GGUF';
const MAX_METADATA_BYTES = 64 * 1024 * 1024;
const READ_SIZES = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024, MAX_METADATA_BYTES];

enum GgufType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

const GGML_TYPE_NAMES: Record<number, string> = {
  0: 'F32',
  1: 'F16',
  2: 'Q4_0',
  3: 'Q4_1',
  6: 'Q5_0',
  7: 'Q5_1',
  8: 'Q8_0',
  9: 'Q8_1',
  10: 'Q2_K',
  11: 'Q3_K',
  12: 'Q4_K',
  13: 'Q5_K',
  14: 'Q6_K',
  15: 'Q8_K',
  16: 'IQ2_XXS',
  17: 'IQ2_XS',
  18: 'IQ3_XXS',
  19: 'IQ1_S',
  20: 'IQ4_NL',
  21: 'IQ3_S',
  22: 'IQ2_S',
  23: 'IQ4_XS',
  24: 'I8',
  25: 'I16',
  26: 'I32',
  27: 'I64',
  28: 'F64',
  29: 'IQ1_M',
  30: 'BF16',
  31: 'Q4_0_4_4',
  32: 'Q4_0_4_8',
  33: 'Q4_0_8_8',
  34: 'TQ1_0',
  35: 'TQ2_0',
};

type ScalarMetadataValue = string | number | boolean;
type MetadataValue = ScalarMetadataValue | ScalarMetadataValue[];

export class NeedMoreDataError extends Error {}

function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`GGUF integer is too large: ${value}`);
  }
  return Number(value);
}

function typeName(typeId: number): string {
  return GGML_TYPE_NAMES[typeId] ?? `TYPE_${typeId}`;
}

function pickPrimaryQuantType(quantTypes: Record<string, number>): string | undefined {
  const entries = Object.entries(quantTypes);
  if (entries.length === 0) return undefined;

  const quantized = entries.filter(([type]) => !['F32', 'F16', 'BF16'].includes(type));
  const candidates = quantized.length > 0 ? quantized : entries;
  candidates.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return candidates[0]?.[0];
}

function numberFrom(values: Map<string, MetadataValue>, key: string): number | undefined {
  const value = values.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringFrom(values: Map<string, MetadataValue>, key: string): string | undefined {
  const value = values.get(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberArrayFrom(values: Map<string, MetadataValue>, key: string): number[] | undefined {
  const value = values.get(key);
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  return numbers.length > 0 ? numbers : undefined;
}

function numberFromOrArrayAverage(values: Map<string, MetadataValue>, key: string): number | undefined {
  const value = numberFrom(values, key);
  if (value !== undefined) return value;
  const valuesArray = numberArrayFrom(values, key);
  if (!valuesArray) return undefined;
  return valuesArray.reduce((sum, item) => sum + item, 0) / valuesArray.length;
}

function firstNumberEnding(values: Map<string, MetadataValue>, suffix: string): number | undefined {
  for (const [key, value] of values) {
    if (key.endsWith(suffix) && typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

class GgufReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  private ensure(size: number) {
    if (this.offset + size > this.buffer.length) {
      throw new NeedMoreDataError();
    }
  }

  private readUInt8(): number {
    this.ensure(1);
    return this.buffer[this.offset++];
  }

  private readInt8(): number {
    this.ensure(1);
    const value = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return value;
  }

  private readUInt16(): number {
    this.ensure(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  private readInt16(): number {
    this.ensure(2);
    const value = this.buffer.readInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  private readUInt32(): number {
    this.ensure(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  private readInt32(): number {
    this.ensure(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  private readFloat32(): number {
    this.ensure(4);
    const value = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }

  private readUInt64(): number {
    this.ensure(8);
    const value = toSafeNumber(this.buffer.readBigUInt64LE(this.offset));
    this.offset += 8;
    return value;
  }

  private readInt64(): number {
    this.ensure(8);
    const value = toSafeNumber(this.buffer.readBigInt64LE(this.offset));
    this.offset += 8;
    return value;
  }

  private readFloat64(): number {
    this.ensure(8);
    const value = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  private readString(): string {
    const length = this.readUInt64();
    this.ensure(length);
    const value = this.buffer.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  private skipString() {
    const length = this.readUInt64();
    this.ensure(length);
    this.offset += length;
  }

  private readScalar(type: GgufType): ScalarMetadataValue | undefined {
    switch (type) {
      case GgufType.UINT8: return this.readUInt8();
      case GgufType.INT8: return this.readInt8();
      case GgufType.UINT16: return this.readUInt16();
      case GgufType.INT16: return this.readInt16();
      case GgufType.UINT32: return this.readUInt32();
      case GgufType.INT32: return this.readInt32();
      case GgufType.FLOAT32: return this.readFloat32();
      case GgufType.BOOL: return this.readUInt8() !== 0;
      case GgufType.STRING: return this.readString();
      case GgufType.UINT64: return this.readUInt64();
      case GgufType.INT64: return this.readInt64();
      case GgufType.FLOAT64: return this.readFloat64();
      default:
        throw new Error(`Unsupported GGUF scalar metadata type: ${type}`);
    }
  }

  private skipScalar(type: GgufType) {
    switch (type) {
      case GgufType.STRING:
        this.skipString();
        return;
      case GgufType.UINT8:
      case GgufType.INT8:
      case GgufType.BOOL:
        this.ensure(1);
        this.offset += 1;
        return;
      case GgufType.UINT16:
      case GgufType.INT16:
        this.ensure(2);
        this.offset += 2;
        return;
      case GgufType.UINT32:
      case GgufType.INT32:
      case GgufType.FLOAT32:
        this.ensure(4);
        this.offset += 4;
        return;
      case GgufType.UINT64:
      case GgufType.INT64:
      case GgufType.FLOAT64:
        this.ensure(8);
        this.offset += 8;
        return;
      case GgufType.ARRAY:
        this.skipArray();
        return;
      default:
        throw new Error(`Unsupported GGUF metadata type: ${type}`);
    }
  }

  private readArray(): ScalarMetadataValue[] | undefined {
    const itemType = this.readUInt32() as GgufType;
    const itemCount = this.readUInt64();
    if (itemType === GgufType.STRING || itemType === GgufType.ARRAY || itemCount > 512) {
      for (let i = 0; i < itemCount; i++) {
        this.skipScalar(itemType);
      }
      return undefined;
    }
    const values: ScalarMetadataValue[] = [];
    for (let i = 0; i < itemCount; i++) {
      const value = this.readScalar(itemType);
      if (value !== undefined) values.push(value);
    }
    return values;
  }

  private skipArray() {
    const itemType = this.readUInt32() as GgufType;
    const itemCount = this.readUInt64();
    for (let i = 0; i < itemCount; i++) {
      this.skipScalar(itemType);
    }
  }

  private readValue(type: GgufType): MetadataValue | undefined {
    if (type === GgufType.ARRAY) {
      return this.readArray();
    }
    return this.readScalar(type);
  }

  parse(source: ModelMetadata['metadataSource']): ModelMetadata {
    this.ensure(24);
    const magic = this.buffer.toString('ascii', 0, 4);
    if (magic !== GGUF_MAGIC) {
      throw new Error(`Not a GGUF file: magic=${magic}`);
    }

    this.offset = 4;
    this.readUInt32(); // version
    const tensorCount = this.readUInt64();
    const metadataCount = this.readUInt64();
    const values = new Map<string, MetadataValue>();

    for (let i = 0; i < metadataCount; i++) {
      const key = this.readString();
      const type = this.readUInt32() as GgufType;
      const value = this.readValue(type);
      if (value !== undefined) {
        values.set(key, value);
      }
    }

    const quantTypes: Record<string, number> = {};
    for (let i = 0; i < tensorCount; i++) {
      this.readString(); // tensor name
      const dimensionCount = this.readUInt32();
      for (let d = 0; d < dimensionCount; d++) {
        this.readUInt64();
      }
      const tensorType = typeName(this.readUInt32());
      this.readUInt64(); // tensor data offset
      quantTypes[tensorType] = (quantTypes[tensorType] ?? 0) + 1;
    }

    const architecture = stringFrom(values, 'general.architecture');
    const prefix = architecture ? `${architecture}.` : '';
    const key = (name: string) => `${prefix}${name}`;
    const attentionHeadCountKvByLayer = numberArrayFrom(values, key('attention.head_count_kv'));

    return {
      architecture,
      name: stringFrom(values, 'general.name'),
      baseName: stringFrom(values, 'general.basename'),
      sizeLabel: stringFrom(values, 'general.size_label'),
      license: stringFrom(values, 'general.license'),
      blockCount: numberFrom(values, key('block_count')) ?? firstNumberEnding(values, '.block_count'),
      contextLength: numberFrom(values, key('context_length')) ?? firstNumberEnding(values, '.context_length'),
      embeddingLength: numberFrom(values, key('embedding_length')) ?? firstNumberEnding(values, '.embedding_length'),
      feedForwardLength: numberFrom(values, key('feed_forward_length')) ?? firstNumberEnding(values, '.feed_forward_length'),
      attentionHeadCount: numberFrom(values, key('attention.head_count')) ?? firstNumberEnding(values, '.attention.head_count'),
      attentionHeadCountKv: numberFromOrArrayAverage(values, key('attention.head_count_kv')) ?? firstNumberEnding(values, '.attention.head_count_kv'),
      attentionHeadCountKvByLayer,
      ropeFreqBase: numberFrom(values, key('rope.freq_base')) ?? firstNumberEnding(values, '.rope.freq_base'),
      ropeDimensionCount: numberFrom(values, key('rope.dimension_count')) ?? firstNumberEnding(values, '.rope.dimension_count'),
      tokenizerModel: stringFrom(values, 'tokenizer.ggml.model'),
      chatTemplate: stringFrom(values, 'tokenizer.chat_template') ?? stringFrom(values, 'tokenizer.ggml.chat_template'),
      bosTokenId: numberFrom(values, 'tokenizer.ggml.bos_token_id'),
      eosTokenId: numberFrom(values, 'tokenizer.ggml.eos_token_id'),
      quantTypes,
      primaryQuantType: pickPrimaryQuantType(quantTypes),
      metadataSource: source,
      isEstimated: false,
    };
  }
}

export function parseGgufMetadata(buffer: Buffer, source: ModelMetadata['metadataSource'] = 'local'): ModelMetadata {
  return new GgufReader(buffer).parse(source);
}

export function readGgufMetadata(filePath: string): ModelMetadata | null {
  const fileSize = statSync(filePath).size;
  const fd = openSync(filePath, 'r');

  try {
    for (const readSize of READ_SIZES) {
      const byteLength = Math.min(fileSize, readSize);
      const buffer = Buffer.allocUnsafe(byteLength);
      readSync(fd, buffer, 0, byteLength, 0);

      try {
        return parseGgufMetadata(buffer, 'local');
      } catch (error) {
        if (error instanceof NeedMoreDataError && byteLength < fileSize && byteLength < MAX_METADATA_BYTES) {
          continue;
        }
        throw error;
      }
    }
  } finally {
    closeSync(fd);
  }

  return null;
}

export async function fetchGgufMetadata(repo: string, filePath: string): Promise<ModelMetadata | null> {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://huggingface.co/${repo}/resolve/main/${encodedPath}`;

  for (const readSize of READ_SIZES) {
    const response = await fetch(url, {
      headers: {
        'Range': `bytes=0-${readSize - 1}`,
        'User-Agent': 'llamacpp-launcher/1.0',
      },
    });

    if (!response.ok) {
      return null;
    }

    if (response.status !== 206) {
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (!contentLength || contentLength > readSize) {
        await response.body?.cancel();
        return null;
      }
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    try {
      return parseGgufMetadata(buffer, 'hf');
    } catch (error) {
      if (error instanceof NeedMoreDataError && buffer.length >= readSize && readSize < MAX_METADATA_BYTES) {
        continue;
      }
      throw error;
    }
  }

  return null;
}
