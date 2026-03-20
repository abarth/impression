/**
 * ABR (Adobe Brush) file parser.
 *
 * Supports ABR versions 6+ (Photoshop 7+), which store brush tip images
 * in `samp` (sample data) sections. Earlier versions (1-5) used a different
 * format and are not supported.
 *
 * References:
 * - https://github.com/scurest/abrupng (Rust, derived from GIMP)
 * - https://github.com/jlai/brush-viewer (TypeScript)
 */

/** Parsed brush parameters from ABR descriptor. */
export interface AbrBrushParams {
  diameter?: number;
  hardness?: number;
  spacing?: number;
  angle?: number;
  roundness?: number;
  opacity?: number;
  flow?: number;
  flipX?: boolean;
  flipY?: boolean;
}

export interface ParsedAbrBrush {
  name: string;
  imageData: Uint8Array;
  width: number;
  height: number;
  /** Brush parameters extracted from ABR descriptor section. */
  params?: AbrBrushParams;
}

class DataViewReader {
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

  seek(pos: number): void {
    this.offset = pos;
  }

  skip(n: number): void {
    this.offset += n;
  }

  readU8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readU16(): number {
    const v = this.view.getUint16(this.offset, false); // big-endian
    this.offset += 2;
    return v;
  }

  readU32(): number {
    const v = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readI32(): number {
    const v = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readF64(): number {
    const v = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return v;
  }

  readBytes(n: number): Uint8Array {
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
    const chars: string[] = [];
    for (let i = 0; i < len; i++) {
      const code = this.readU16();
      if (code === 0) continue; // skip null terminator
      chars.push(String.fromCharCode(code));
    }
    return chars.join("");
  }
}

/**
 * Decode RLE-compressed brush sample data.
 * ABR uses PackBits-style RLE per scanline.
 */
function decodeRLE(
  reader: DataViewReader,
  width: number,
  height: number,
  depth: number,
): Uint8Array {
  const bytesPerPixel = depth === 16 ? 2 : 1;
  const rowBytes = width * bytesPerPixel;
  const output = new Uint8Array(width * height);

  // Read scanline byte counts (one per row)
  const scanlineLengths: number[] = [];
  for (let i = 0; i < height; i++) {
    scanlineLengths.push(reader.readU16());
  }

  for (let row = 0; row < height; row++) {
    const rowEnd = reader.position + scanlineLengths[row];
    let col = 0;

    while (reader.position < rowEnd && col < rowBytes) {
      const n = reader.readU8();
      if (n <= 127) {
        // Copy next n+1 bytes literally
        const count = n + 1;
        for (let i = 0; i < count && col < rowBytes; i++) {
          const val = bytesPerPixel === 2 ? reader.readU16() >> 8 : reader.readU8();
          output[row * width + col / bytesPerPixel] = val;
          col += bytesPerPixel;
        }
      } else if (n > 128) {
        // Repeat next byte 257-n times
        const count = 257 - n;
        const val = bytesPerPixel === 2 ? reader.readU16() >> 8 : reader.readU8();
        for (let i = 0; i < count && col < rowBytes; i++) {
          output[row * width + col / bytesPerPixel] = val;
          col += bytesPerPixel;
        }
      }
      // n === 128: no-op
    }

    reader.seek(rowEnd);
  }

  return output;
}

/**
 * Parse a `samp` section to extract brush tip images.
 *
 * Each entry has a 4-byte length prefix, then an opaque header blob
 * (47 bytes for sub-version 1, 301 bytes for sub-version 2),
 * followed by bounds, depth, compression, and pixel data.
 * Matching the GIMP and abrupng reference implementations.
 */
function parseSampSection(
  reader: DataViewReader,
  endPos: number,
  subVersion: number,
): ParsedAbrBrush[] {
  const brushes: ParsedAbrBrush[] = [];
  const skipBytes = subVersion >= 2 ? 301 : 47;

  while (reader.position + 4 < endPos) {
    if (reader.remaining < 4) break;

    const sampleLength = reader.readU32();
    if (sampleLength === 0) break;

    const sampleEnd = reader.position + sampleLength;
    if (sampleEnd > endPos) break;

    // Align next entry to 4-byte boundary
    const nextEntry = (sampleEnd + 3) & ~3;

    // Skip the opaque header blob (misc, spacing, antialiasing, short bounds, etc.)
    if (sampleLength < skipBytes + 19) {
      reader.seek(nextEntry);
      continue;
    }
    reader.skip(skipBytes);

    // Read bounds: top, left, bottom, right (each 4 bytes, big-endian i32)
    const boundsTop = reader.readI32();
    const boundsLeft = reader.readI32();
    const boundsBottom = reader.readI32();
    const boundsRight = reader.readI32();

    const depth = reader.readU16();
    const compression = reader.readU8();

    const width = boundsRight - boundsLeft;
    const height = boundsBottom - boundsTop;

    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) {
      reader.seek(nextEntry);
      continue;
    }

    let imageData: Uint8Array;
    if (compression === 0) {
      // Raw data
      const bytesPerPixel = depth === 16 ? 2 : 1;
      const rawSize = width * height * bytesPerPixel;
      if (reader.remaining < rawSize) {
        reader.seek(nextEntry);
        continue;
      }
      if (depth === 16) {
        imageData = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
          imageData[i] = reader.readU16() >> 8;
        }
      } else {
        imageData = new Uint8Array(reader.readBytes(rawSize));
      }
    } else if (compression === 1) {
      // RLE
      imageData = decodeRLE(reader, width, height, depth);
    } else {
      reader.seek(nextEntry);
      continue;
    }

    brushes.push({
      name: `Brush ${brushes.length + 1}`,
      imageData,
      width,
      height,
    });

    reader.seek(nextEntry);
  }

  return brushes;
}

/** Read a ClassID: 4-byte length, then either 4-char tag (if len=0) or full string. */
function readClassId(reader: DataViewReader): string {
  const len = reader.readU32();
  if (len === 0) {
    return reader.readTag();
  }
  const bytes = reader.readBytes(len);
  return new TextDecoder("ascii").decode(bytes);
}

/** Read a key (same format as ClassID). */
function readKey(reader: DataViewReader): string {
  return readClassId(reader);
}

type DescriptorValue =
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

/** Parse a single descriptor value based on its type tag. */
function readDescriptorValue(reader: DataViewReader, endPos: number): DescriptorValue {
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

interface ParsedDescriptor {
  name: string;
  classId: string;
  items: Map<string, DescriptorValue>;
}

/** Parse a Photoshop descriptor object. */
function readDescriptor(reader: DataViewReader, endPos: number): ParsedDescriptor {
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

/** Get a numeric value from a descriptor item (handles UntF, doub, long). */
function getNumber(items: Map<string, DescriptorValue>, key: string): number | undefined {
  const v = items.get(key);
  if (!v) return undefined;
  if (v.type === "UntF") return v.value;
  if (v.type === "doub") return v.value;
  if (v.type === "long") return v.value;
  return undefined;
}

/** Get a boolean value from a descriptor item. */
function getBool(items: Map<string, DescriptorValue>, key: string): boolean | undefined {
  const v = items.get(key);
  if (!v || v.type !== "bool") return undefined;
  return v.value;
}

/** Extract brush parameters from a parsed descriptor. */
function extractBrushParams(items: Map<string, DescriptorValue>): AbrBrushParams {
  const params: AbrBrushParams = {};

  const diameter = getNumber(items, "Dmtr");
  if (diameter !== undefined) params.diameter = diameter;

  const hardness = getNumber(items, "Hrdn");
  if (hardness !== undefined) params.hardness = hardness / 100; // Convert from %

  const spacing = getNumber(items, "Spcn");
  if (spacing !== undefined) params.spacing = spacing / 100; // Convert from %

  const angle = getNumber(items, "Angl");
  if (angle !== undefined) params.angle = angle;

  const roundness = getNumber(items, "Rndn");
  if (roundness !== undefined) params.roundness = roundness / 100; // Convert from %

  const opacity = getNumber(items, "Opct");
  if (opacity !== undefined) params.opacity = opacity / 100; // Convert from %

  // Flow key has a trailing space in Photoshop descriptors
  const flow = getNumber(items, "Fl  ");
  if (flow !== undefined) params.flow = flow / 100; // Convert from %

  const flipX = getBool(items, "flipX");
  if (flipX !== undefined) params.flipX = flipX;

  const flipY = getBool(items, "flipY");
  if (flipY !== undefined) params.flipY = flipY;

  return params;
}

interface ParsedPresetInfo {
  name: string;
  params: AbrBrushParams;
  isSampled: boolean;
}

interface ParsedDescSection {
  presets: ParsedPresetInfo[];
}

/** Get a nested descriptor's items from a parent descriptor. */
function getObjc(items: Map<string, DescriptorValue>, key: string): Map<string, DescriptorValue> | undefined {
  const v = items.get(key);
  if (!v || v.type !== "Objc") return undefined;
  return v.items;
}

/** Get a string value from a descriptor item. */
function getText(items: Map<string, DescriptorValue>, key: string): string | undefined {
  const v = items.get(key);
  if (!v || v.type !== "TEXT") return undefined;
  return v.value;
}

/**
 * Extract brush parameters from a brushPreset descriptor.
 * Parameters come from the nested "Brsh" object and "toolOptions" object.
 */
function extractPresetParams(presetItems: Map<string, DescriptorValue>): AbrBrushParams {
  // Get params from nested "Brsh" descriptor (computedBrush or sampledBrush)
  const brushItems = getObjc(presetItems, "Brsh");
  const params = brushItems ? extractBrushParams(brushItems) : {};

  // Opacity and flow live in "toolOptions" as integer percentages
  const toolOpts = getObjc(presetItems, "toolOptions");
  if (toolOpts) {
    const opct = getNumber(toolOpts, "Opct");
    if (opct !== undefined) params.opacity = opct / 100;
    const flow = getNumber(toolOpts, "flow");
    if (flow !== undefined) params.flow = flow / 100;
  }

  return params;
}

/**
 * Parse a `desc` section to extract brush names and parameters.
 *
 * The section starts with a 4-byte version number, then contains a single
 * top-level descriptor with a "Brsh" key holding a VlLs (list) of
 * brushPreset descriptors.
 */
function parseDescSection(
  reader: DataViewReader,
  endPos: number,
): ParsedDescSection {
  const presets: ParsedPresetInfo[] = [];

  try {
    // Skip 4-byte version prefix
    reader.skip(4);

    const descriptor = readDescriptor(reader, endPos);

    // The top-level descriptor has a "Brsh" key with a list of brush presets
    const brshList = descriptor.items.get("Brsh");
    if (brshList && brshList.type === "VlLs") {
      for (const item of brshList.values) {
        if (item.type !== "Objc") continue;
        const name = getText(item.items, "Nm  ") || `Brush ${presets.length + 1}`;
        const brsh = getObjc(item.items, "Brsh");
        const isSampled = brsh ? getText(brsh, "sampledData") !== undefined : false;
        presets.push({
          name,
          params: extractPresetParams(item.items),
          isSampled,
        });
      }
    }
  } catch {
    // Skip on parse error
  }

  return { presets };
}

/**
 * Parse an ABR file and extract brush tip images.
 */
export function parseAbrFile(buffer: ArrayBuffer): ParsedAbrBrush[] {
  const reader = new DataViewReader(buffer);

  if (reader.remaining < 4) return [];

  const version = reader.readU16();
  const subVersion = reader.readU16();

  // We only support version 6+ (Photoshop 7+)
  if (version < 6) return [];

  const brushes: ParsedAbrBrush[] = [];
  let descPresets: ParsedPresetInfo[] = [];

  while (reader.remaining >= 8) {
    const tag = reader.readTag();

    if (tag !== "8BIM") {
      // Try to recover by seeking back
      reader.skip(-3);
      continue;
    }

    const sectionTag = reader.readTag();
    const sectionSize = reader.readU32();
    const sectionEnd = reader.position + sectionSize;

    if (sectionEnd > reader.position + reader.remaining) break;

    if (sectionTag === "samp") {
      const parsed = parseSampSection(reader, sectionEnd, subVersion);
      brushes.push(...parsed);
    } else if (sectionTag === "desc") {
      const { presets } = parseDescSection(reader, sectionEnd);
      descPresets = presets;
    }

    reader.seek(sectionEnd);
  }

  // Map sampled preset names/params to samp entries (in order).
  // Computed presets have no samp entry so we skip them.
  let sampIdx = 0;
  for (const preset of descPresets) {
    if (preset.isSampled && sampIdx < brushes.length) {
      brushes[sampIdx].name = preset.name;
      brushes[sampIdx].params = preset.params;
      sampIdx++;
    }
  }

  return brushes;
}
