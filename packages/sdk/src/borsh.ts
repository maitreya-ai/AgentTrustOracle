import { addressBytes, encodeAddress } from "@ato/core";

/** Minimal little-endian borsh writer/reader for the oracle's fixed layouts. */
export class Writer {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  private o = 0;

  private ensure(n: number) {
    if (this.o + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.o + n));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.o);
    this.o += b.length;
    return this;
  }
  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.o, v);
    this.o += 1;
    return this;
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.o, v, true);
    this.o += 2;
    return this;
  }
  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.o, v >>> 0, true);
    this.o += 4;
    return this;
  }
  u64(v: bigint): this {
    this.ensure(8);
    this.view.setBigUint64(this.o, v, true);
    this.o += 8;
    return this;
  }
  i64(v: bigint): this {
    this.ensure(8);
    this.view.setBigInt64(this.o, v, true);
    this.o += 8;
    return this;
  }
  pubkey(a: string): this {
    return this.bytes(addressBytes(a));
  }
  option<T>(v: T | null | undefined, write: (v: T) => void): this {
    if (v === null || v === undefined) return this.u8(0);
    this.u8(1);
    write(v);
    return this;
  }
  zeros(n: number): this {
    return this.bytes(new Uint8Array(n));
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.o);
  }
}

export class Reader {
  private o = 0;
  private view: DataView;
  constructor(private readonly d: Uint8Array) {
    this.view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  }
  get offset() {
    return this.o;
  }
  bytes(n: number): Uint8Array {
    if (this.o + n > this.d.length) throw new Error("buffer underflow");
    const out = this.d.slice(this.o, this.o + n);
    this.o += n;
    return out;
  }
  u8() {
    return this.bytes(1)[0] as number;
  }
  bool() {
    return this.u8() === 1;
  }
  u16() {
    const v = this.view.getUint16(this.o, true);
    this.o += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  u64() {
    const v = this.view.getBigUint64(this.o, true);
    this.o += 8;
    return v;
  }
  i64() {
    const v = this.view.getBigInt64(this.o, true);
    this.o += 8;
    return v;
  }
  pubkey() {
    return encodeAddress(this.bytes(32));
  }
  option<T>(read: () => T): T | null {
    return this.u8() === 1 ? read() : null;
  }
}
