import { closeSync, openSync, readSync, statSync } from 'node:fs';

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

export interface GgufMetadata {
  architecture?: string;
  blockCount?: number;
  blockCountKey?: string;
}

class NeedMoreDataError extends Error {}

function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`GGUF integer is too large: ${value}`);
  }
  return Number(value);
}

class MetadataReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  private ensure(size: number) {
    if (this.offset + size > this.buffer.length) {
      throw new NeedMoreDataError();
    }
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

  private readUInt64(): number {
    this.ensure(8);
    const value = toSafeNumber(this.buffer.readBigUInt64LE(this.offset));
    this.offset += 8;
    return value;
  }

  private readInt64(): number {
    this.ensure(8);
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return Number(value);
  }

  private readString(): string {
    const length = this.readUInt64();
    this.ensure(length);
    const value = this.buffer.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  private skipScalar(type: GgufType): unknown {
    switch (type) {
      case GgufType.UINT8:
      case GgufType.INT8:
      case GgufType.BOOL:
        this.ensure(1);
        return this.buffer[this.offset++];
      case GgufType.UINT16:
        this.ensure(2);
        this.offset += 2;
        return undefined;
      case GgufType.INT16:
        this.ensure(2);
        this.offset += 2;
        return undefined;
      case GgufType.UINT32:
        return this.readUInt32();
      case GgufType.INT32:
        return this.readInt32();
      case GgufType.FLOAT32:
        this.ensure(4);
        this.offset += 4;
        return undefined;
      case GgufType.STRING:
        return this.readString();
      case GgufType.UINT64:
        return this.readUInt64();
      case GgufType.INT64:
        return this.readInt64();
      case GgufType.FLOAT64:
        this.ensure(8);
        this.offset += 8;
        return undefined;
      case GgufType.ARRAY:
        return this.skipArray();
      default:
        throw new Error(`Unsupported GGUF metadata value type: ${type}`);
    }
  }

  private skipArray(): undefined {
    const itemType = this.readUInt32() as GgufType;
    const itemCount = this.readUInt64();
    for (let i = 0; i < itemCount; i++) {
      this.skipScalar(itemType);
    }
    return undefined;
  }

  parse(): GgufMetadata {
    this.ensure(24);
    const magic = this.buffer.toString('ascii', 0, 4);
    if (magic !== GGUF_MAGIC) {
      throw new Error(`Not a GGUF file: magic=${magic}`);
    }

    this.offset = 4;
    this.readUInt32(); // version
    this.readUInt64(); // tensor count
    const metadataCount = this.readUInt64();

    const metadata: GgufMetadata = {};

    for (let i = 0; i < metadataCount; i++) {
      const key = this.readString();
      const type = this.readUInt32() as GgufType;
      const value = this.skipScalar(type);

      if (key === 'general.architecture' && typeof value === 'string') {
        metadata.architecture = value;
      }

      if (key.endsWith('.block_count') && typeof value === 'number') {
        metadata.blockCount = value;
        metadata.blockCountKey = key;
      }
    }

    return metadata;
  }
}

export function parseGgufMetadata(buffer: Buffer): GgufMetadata {
  return new MetadataReader(buffer).parse();
}

export function readGgufMetadata(filePath: string): GgufMetadata | null {
  const fileSize = statSync(filePath).size;
  const fd = openSync(filePath, 'r');

  try {
    for (const readSize of READ_SIZES) {
      const byteLength = Math.min(fileSize, readSize);
      const buffer = Buffer.allocUnsafe(byteLength);
      readSync(fd, buffer, 0, byteLength, 0);

      try {
        return parseGgufMetadata(buffer);
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

export async function fetchGgufMetadata(repo: string, filePath: string): Promise<GgufMetadata | null> {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://huggingface.co/${repo}/resolve/main/${encodedPath}`;

  for (const readSize of READ_SIZES) {
    const response = await fetch(url, {
      headers: {
        'Range': `bytes=0-${readSize - 1}`,
        'User-Agent': 'llamacpp-launcher/1.0',
      },
    });

    if (!response.ok && response.status !== 206) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    try {
      return parseGgufMetadata(buffer);
    } catch (error) {
      if (error instanceof NeedMoreDataError && buffer.length >= readSize && readSize < MAX_METADATA_BYTES) {
        continue;
      }
      throw error;
    }
  }

  return null;
}
