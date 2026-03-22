import { describe, it, expect } from "vitest";
import { DataViewReader } from "../photoshopDescriptor";

function bufferOf(...bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe("DataViewReader bounds checking", () => {
  it("readU8 throws on empty buffer", () => {
    const reader = new DataViewReader(bufferOf());
    expect(() => reader.readU8()).toThrow("Buffer underflow");
  });

  it("readU16 throws when only 1 byte remains", () => {
    const reader = new DataViewReader(bufferOf(0xff));
    expect(() => reader.readU16()).toThrow("Buffer underflow");
  });

  it("readU32 throws when only 3 bytes remain", () => {
    const reader = new DataViewReader(bufferOf(0, 0, 0));
    expect(() => reader.readU32()).toThrow("Buffer underflow");
  });

  it("readI32 throws when only 2 bytes remain", () => {
    const reader = new DataViewReader(bufferOf(0, 0));
    expect(() => reader.readI32()).toThrow("Buffer underflow");
  });

  it("readF64 throws when only 4 bytes remain", () => {
    const reader = new DataViewReader(bufferOf(0, 0, 0, 0));
    expect(() => reader.readF64()).toThrow("Buffer underflow");
  });

  it("readBytes throws when requesting more than available", () => {
    const reader = new DataViewReader(bufferOf(1, 2, 3));
    expect(() => reader.readBytes(5)).toThrow("Buffer underflow");
  });

  it("readTag throws when fewer than 4 bytes remain", () => {
    const reader = new DataViewReader(bufferOf(0x41, 0x42));
    expect(() => reader.readTag()).toThrow("Buffer underflow");
  });

  it("succeeds when exact bytes are available", () => {
    const reader = new DataViewReader(bufferOf(0, 0, 0, 42));
    expect(reader.readU32()).toBe(42);
    expect(reader.remaining).toBe(0);
  });

  it("tracks position correctly across reads", () => {
    const reader = new DataViewReader(bufferOf(0x01, 0x02, 0x03, 0x04));
    expect(reader.readU8()).toBe(1);
    expect(reader.readU8()).toBe(2);
    expect(reader.remaining).toBe(2);
    expect(reader.readU16()).toBe(0x0304);
    expect(reader.remaining).toBe(0);
  });

  it("error message includes remaining count", () => {
    const reader = new DataViewReader(bufferOf(0xff));
    try {
      reader.readU32();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("have 1");
      expect((e as Error).message).toContain("need 4");
    }
  });
});
