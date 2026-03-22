/**
 * Shared Photoshop descriptor parser.
 *
 * Adobe Photoshop uses a binary descriptor format in many file types
 * (ABR, GRD, ASL, etc.) to serialize nested key-value structures.
 * This module provides the low-level parsing primitives.
 *
 * References:
 * - https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/
 */

export class DataViewReader {
  private view: DataView;
  private offset: number;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.offset = 0;
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  /** Throw if fewer than `n` bytes remain. */
  private checkBounds(n: number): void {
    if (n > this.remaining) {
      throw new Error(
        `Buffer underflow: need ${n} bytes, have ${this.remaining}`,
      );
    }
  }

  seek(pos: number): void {
    this.offset = pos;
  }

  skip(n: number): void {
    this.offset += n;
  }

  readU8(): number {
    this.checkBounds(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readU16(): number {
    this.checkBounds(2);
    const v = this.view.getUint16(this.offset, false); // big-endian
    this.offset += 2;
    return v;
  }

  readU32(): number {
    this.checkBounds(4);
    const v = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readI32(): number {
    this.checkBounds(4);
    const v = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readF64(): number {
    this.checkBounds(8);
    const v = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return v;
  }

  readBytes(n: number): Uint8Array {
    this.checkBounds(n);
    const bytes = new Uint8Array(this.view.buffer, this.offset, n);
    this.offset += n;
    return bytes;
  }

  readTag(): string {
    const bytes = this.readBytes(4);
    return String.fromCharCode(...bytes);
  }

  /** Read a Pascal-style string (1-byte length prefix). */
  readPascalString(): string {
    const len = this.readU8();
    const bytes = this.readBytes(len);
    // Pad to even
    if ((len + 1) % 2 !== 0) this.skip(1);
    return new TextDecoder("ascii").decode(bytes);
  }

  /** Read a Unicode string (4-byte length prefix, UTF-16BE). */
  readUnicodeString(): string {
    const len = this.readU32(); // number of UTF-16 code units including null
    if (len === 0) return "";
    this.checkBounds(len * 2);
    const chars: string[] = [];
    for (let i = 0; i < len; i++) {
      const code = this.readU16();
      if (code === 0) continue; // skip null terminator
      chars.push(String.fromCharCode(code));
    }
    return chars.join("");
  }
}

// --- Descriptor value types ---

export type DescriptorValue =
  | { type: "long"; value: number }
  | { type: "doub"; value: number }
  | { type: "UntF"; unit: string; value: number }
  | { type: "bool"; value: boolean }
  | { type: "enum"; enumType: string; value: string }
  | { type: "TEXT"; value: string }
  | { type: "Objc"; classId: string; items: Map<string, DescriptorValue> }
  | { type: "VlLs"; values: DescriptorValue[] }
  | { type: "tdta"; data: Uint8Array }
  | { type: "unknown" };

export interface ParsedDescriptor {
  name: string;
  classId: string;
  items: Map<string, DescriptorValue>;
}

// --- Low-level parsing functions ---

/** Read a ClassID: 4-byte length, then either 4-char tag (if len=0) or full string. */
export function readClassId(reader: DataViewReader): string {
  const len = reader.readU32();
  if (len === 0) {
    return reader.readTag();
  }
  const bytes = reader.readBytes(len);
  return new TextDecoder("ascii").decode(bytes);
}

/** Read a key (same format as ClassID). */
export function readKey(reader: DataViewReader): string {
  return readClassId(reader);
}

/** Parse a single descriptor value based on its type tag. */
export function readDescriptorValue(
  reader: DataViewReader,
  endPos: number,
): DescriptorValue {
  const typeTag = reader.readTag();
  switch (typeTag) {
    case "long":
      return { type: "long", value: reader.readI32() };
    case "doub":
      return { type: "doub", value: reader.readF64() };
    case "UntF": {
      const unit = reader.readTag();
      const value = reader.readF64();
      return { type: "UntF", unit, value };
    }
    case "bool":
      return { type: "bool", value: reader.readU8() !== 0 };
    case "enum": {
      const enumType = readClassId(reader);
      const value = readClassId(reader);
      return { type: "enum", enumType, value };
    }
    case "TEXT":
      return { type: "TEXT", value: reader.readUnicodeString() };
    case "Objc": {
      // Nested descriptor
      const result = readDescriptor(reader, endPos);
      return { type: "Objc", classId: result.classId, items: result.items };
    }
    case "tdta": {
      const len = reader.readU32();
      const data = new Uint8Array(reader.readBytes(len));
      return { type: "tdta", data };
    }
    case "VlLs": {
      const count = reader.readU32();
      const values: DescriptorValue[] = [];
      for (let i = 0; i < count && reader.position < endPos; i++) {
        const item = readDescriptorValue(reader, endPos);
        values.push(item);
        if (item.type === "unknown") break;
      }
      return { type: "VlLs", values };
    }
    default:
      // Unknown type — can't safely skip without knowing size
      return { type: "unknown" };
  }
}

/** Parse a Photoshop descriptor object. */
export function readDescriptor(
  reader: DataViewReader,
  endPos: number,
): ParsedDescriptor {
  const name = reader.readUnicodeString();
  const classId = readClassId(reader);
  const itemCount = reader.readU32();
  const items = new Map<string, DescriptorValue>();

  for (let i = 0; i < itemCount && reader.position < endPos; i++) {
    const key = readKey(reader);
    const value = readDescriptorValue(reader, endPos);
    if (value.type !== "unknown") {
      items.set(key, value);
    } else {
      // Can't continue parsing after unknown type
      break;
    }
  }

  return { name, classId, items };
}

// --- Helper functions for extracting typed values from descriptor items ---

/** Get a numeric value from a descriptor item (handles UntF, doub, long). */
export function getNumber(
  items: Map<string, DescriptorValue>,
  key: string,
): number | undefined {
  const v = items.get(key);
  if (!v) return undefined;
  if (v.type === "UntF") return v.value;
  if (v.type === "doub") return v.value;
  if (v.type === "long") return v.value;
  return undefined;
}

/** Get a boolean value from a descriptor item. */
export function getBool(
  items: Map<string, DescriptorValue>,
  key: string,
): boolean | undefined {
  const v = items.get(key);
  if (!v || v.type !== "bool") return undefined;
  return v.value;
}

/** Get a nested descriptor's items from a parent descriptor. */
export function getObjc(
  items: Map<string, DescriptorValue>,
  key: string,
): Map<string, DescriptorValue> | undefined {
  const v = items.get(key);
  if (!v || v.type !== "Objc") return undefined;
  return v.items;
}

/** Get a string value from a descriptor item. */
export function getText(
  items: Map<string, DescriptorValue>,
  key: string,
): string | undefined {
  const v = items.get(key);
  if (!v || v.type !== "TEXT") return undefined;
  return v.value;
}

/** Get the value string of an enum descriptor item. */
export function getEnum(
  items: Map<string, DescriptorValue>,
  key: string,
): string | undefined {
  const v = items.get(key);
  if (!v || v.type !== "enum") return undefined;
  return v.value;
}

/** Get a list of descriptor values. */
export function getList(
  items: Map<string, DescriptorValue>,
  key: string,
): DescriptorValue[] | undefined {
  const v = items.get(key);
  if (!v || v.type !== "VlLs") return undefined;
  return v.values;
}
