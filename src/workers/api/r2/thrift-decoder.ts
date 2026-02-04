/**
 * Thrift Binary Protocol Decoder
 *
 * Simple Thrift decoder for Parquet footer parsing.
 * Implements compact protocol encoding.
 */

/**
 * Thrift field header
 */
export interface ThriftFieldHeader {
  type: number;
  id: number;
}

/**
 * Thrift list header
 */
export interface ThriftListHeader {
  elemType: number;
  size: number;
}

/**
 * Simple Thrift decoder for Parquet footer parsing
 */
export class ThriftDecoder {
  private data: Uint8Array;
  private offset: number = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  hasMore(): boolean {
    return this.offset < this.data.length;
  }

  readFieldHeader(): ThriftFieldHeader {
    const byte = this.data[this.offset++];
    if (byte === undefined) {
      return { type: 0, id: 0 }; // STOP
    }
    const type = byte & 0x0f;

    if (type === 0) {
      return { type: 0, id: 0 }; // STOP
    }

    let id: number;
    const delta = (byte >> 4) & 0x0f;
    if (delta === 0) {
      id = this.readI16();
    } else {
      id = delta;
    }

    return { type, id };
  }

  readI16(): number {
    const value = this.readVarint();
    return (value >>> 1) ^ -(value & 1); // Zigzag decode
  }

  readI32(): number {
    const value = this.readVarint();
    return (value >>> 1) ^ -(value & 1); // Zigzag decode
  }

  readI64(): bigint {
    const value = this.readVarintBig();
    return (value >> 1n) ^ -(value & 1n); // Zigzag decode
  }

  readString(): string {
    const length = this.readVarint();
    const bytes = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  readBinary(): Uint8Array {
    const length = this.readVarint();
    const bytes = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  readListHeader(): ThriftListHeader {
    const byte = this.data[this.offset++];
    if (byte === undefined) {
      return { elemType: 0, size: 0 };
    }
    const size = (byte >> 4) & 0x0f;

    if (size === 0x0f) {
      return { elemType: byte & 0x0f, size: this.readVarint() };
    }

    return { elemType: byte & 0x0f, size };
  }

  skip(type: number): void {
    switch (type) {
      case 1: // BOOL_TRUE/FALSE
        break;
      case 3: // I8
        this.offset++;
        break;
      case 4: // I16
        this.readVarint();
        break;
      case 5: // I32
        this.readVarint();
        break;
      case 6: // I64
        this.readVarintBig();
        break;
      case 7: // DOUBLE
        this.offset += 8;
        break;
      case 8: // BINARY/STRING
        const len = this.readVarint();
        this.offset += len;
        break;
      case 9: // LIST
        this.skipList();
        break;
      case 10: // SET
        this.skipList();
        break;
      case 11: // MAP
        this.skipMap();
        break;
      case 12: // STRUCT
        this.skipStruct();
        break;
    }
  }

  private skipList(): void {
    const header = this.readListHeader();
    for (let i = 0; i < header.size; i++) {
      this.skip(header.elemType);
    }
  }

  private skipMap(): void {
    const length = this.readVarint();
    if (length > 0) {
      const byte = this.data[this.offset++];
      if (byte === undefined) return;
      const keyType = (byte >> 4) & 0x0f;
      const valueType = byte & 0x0f;
      for (let i = 0; i < length; i++) {
        this.skip(keyType);
        this.skip(valueType);
      }
    }
  }

  private skipStruct(): void {
    while (this.hasMore()) {
      const field = this.readFieldHeader();
      if (field.type === 0) break;
      this.skip(field.type);
    }
  }

  private readVarint(): number {
    let value = 0;
    let shift = 0;

    while (this.offset < this.data.length) {
      const byte = this.data[this.offset++];
      if (byte === undefined) break;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }

    return value >>> 0;
  }

  private readVarintBig(): bigint {
    let value = 0n;
    let shift = 0n;

    while (this.offset < this.data.length) {
      const byte = this.data[this.offset++];
      if (byte === undefined) break;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
    }

    return value;
  }
}
