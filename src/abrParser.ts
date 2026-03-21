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

import type { ShapeDynamics, TransferDynamics, DynamicParam, DynamicControl, DualBrushSettings } from "./hooks/useBrushSettings";
import {
  DUAL_BRUSH_MODE_MULTIPLY,
  DUAL_BRUSH_MODE_DARKEN,
  DUAL_BRUSH_MODE_LIGHTEN,
  DUAL_BRUSH_MODE_SUBTRACT,
  DUAL_BRUSH_MODE_LINEAR_DODGE,
  DUAL_BRUSH_MODE_SCREEN,
} from "./hooks/useBrushSettings";

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
  smoothing?: number;
  shapeDynamics?: ShapeDynamics;
  transferDynamics?: TransferDynamics;
  dualBrush?: DualBrushSettings;
}

export interface ParsedAbrBrush {
  name: string;
  /** Image data for sampled brush tips. Undefined for computed (circle) tips. */
  imageData?: Uint8Array;
  /** Width of the tip image (only set for sampled tips). */
  width?: number;
  /** Height of the tip image (only set for sampled tips). */
  height?: number;
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

/** A sampled brush tip image keyed by its UUID (from the samp entry header). */
interface SampEntry {
  uuid: string;
  imageData: Uint8Array;
  width: number;
  height: number;
}

/**
 * Parse a `samp` section to extract brush tip images keyed by UUID.
 *
 * Each entry has a 4-byte length prefix, then an opaque header blob
 * (47 bytes for sub-version 1, 301 bytes for sub-version 2),
 * followed by bounds, depth, compression, and pixel data.
 * For sub-version 2, the first bytes of the header are a Pascal string
 * containing the tip UUID used for mapping to desc preset entries.
 */
function parseSampSection(
  reader: DataViewReader,
  endPos: number,
  subVersion: number,
): SampEntry[] {
  const entries: SampEntry[] = [];
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

    // For sub-version 2, read the UUID from the Pascal string at the header start
    const headerStart = reader.position;
    let uuid = `samp-${entries.length}`;
    if (subVersion >= 2) {
      uuid = reader.readPascalString();
    }
    reader.seek(headerStart + skipBytes);

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

    entries.push({ uuid, imageData, width, height });
    reader.seek(nextEntry);
  }

  return entries;
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

/** Get the value string of an enum descriptor item. */
function getEnum(items: Map<string, DescriptorValue>, key: string): string | undefined {
  const v = items.get(key);
  if (!v || v.type !== "enum") return undefined;
  return v.value;
}

/** Map a Photoshop blend mode 4-char key to our DualBrushMode constant.
 *  PS dual brush supports: Multiply, Darken, Lighten, Color Dodge (≈Linear Dodge),
 *  Color Burn (≈Subtract), Screen, Overlay, Hard Mix, Difference, Exclusion.
 *  We map the ones we support; unsupported modes fall back to Multiply. */
function mapDualBrushMode(psKey: string | undefined): number {
  switch (psKey) {
    case "Mltp": return DUAL_BRUSH_MODE_MULTIPLY;
    case "Drkn": return DUAL_BRUSH_MODE_DARKEN;
    case "Lghn": return DUAL_BRUSH_MODE_LIGHTEN;
    case "Sbtr": return DUAL_BRUSH_MODE_SUBTRACT;
    case "LnDd": return DUAL_BRUSH_MODE_LINEAR_DODGE;
    case "Scrn": return DUAL_BRUSH_MODE_SCREEN;
    // Color Dodge is close enough to Linear Dodge for alpha values
    case "CDdg": return DUAL_BRUSH_MODE_LINEAR_DODGE;
    default: return DUAL_BRUSH_MODE_MULTIPLY;
  }
}

/** Extract brush parameters from a "Brsh" sub-descriptor (computedBrush or sampledBrush). */
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

  const flipX = getBool(items, "flipX");
  if (flipX !== undefined) params.flipX = flipX;

  const flipY = getBool(items, "flipY");
  if (flipY !== undefined) params.flipY = flipY;

  return params;
}

/**
 * Convert a Photoshop brush variation descriptor (brVr) to our DynamicParam.
 *
 * PS bVTy values: 0=Off, 2=PenPressure, 5=Direction, 6=InitialDirection.
 * We map: 2→PenPressure(1). Off with jitter>0→Random(2). Unsupported→Off(0).
 */
function mapDynamicParam(items: Map<string, DescriptorValue> | undefined): DynamicParam {
  if (!items) return { jitter: 0, control: 0, minimum: 0 };
  const bVTy = getNumber(items, "bVTy") ?? 0;
  const jitter = (getNumber(items, "jitter") ?? 0) / 100;
  const minimum = (getNumber(items, "Mnm ") ?? 0) / 100;

  // Map Photoshop bVTy values to our DynamicControl.
  // bVTy=2 is Pen Pressure. bVTy=0 is Off (jitter still applies as random variation).
  let control: DynamicControl = 0;
  if (bVTy === 2) {
    control = 1; // Pen Pressure
  }

  return { jitter, control, minimum };
}

/** Parsed info for a single preset from the desc section. */
interface ParsedPresetInfo {
  name: string;
  params: AbrBrushParams;
  /** UUID of the sampled tip, or undefined for computed tips. */
  tipUuid?: string;
}

interface ParsedDescSection {
  presets: ParsedPresetInfo[];
}

/**
 * Extract full brush parameters from a brushPreset descriptor.
 * Includes brush tip params, dynamics, and tool options.
 */
function extractPresetParams(presetItems: Map<string, DescriptorValue>): AbrBrushParams {
  // Get params from nested "Brsh" descriptor (computedBrush or sampledBrush)
  const brushItems = getObjc(presetItems, "Brsh");
  const params = brushItems ? extractBrushParams(brushItems) : {};

  // Opacity, flow, and smoothing from "toolOptions"
  const toolOpts = getObjc(presetItems, "toolOptions");
  if (toolOpts) {
    const opct = getNumber(toolOpts, "Opct");
    if (opct !== undefined) params.opacity = opct / 100;
    const flow = getNumber(toolOpts, "flow");
    if (flow !== undefined) params.flow = flow / 100;
    const smoo = getNumber(toolOpts, "Smoo");
    if (smoo !== undefined) params.smoothing = smoo / 100;
  }

  // Shape dynamics
  const useTipDyn = getBool(presetItems, "useTipDynamics");
  if (useTipDyn) {
    params.shapeDynamics = {
      size: mapDynamicParam(getObjc(presetItems, "szVr")),
      angle: mapDynamicParam(getObjc(presetItems, "angleDynamics")),
      roundness: mapDynamicParam(getObjc(presetItems, "roundnessDynamics")),
    };
  }

  // Transfer dynamics
  const usePaintDyn = getBool(presetItems, "usePaintDynamics");
  if (usePaintDyn) {
    params.transferDynamics = {
      opacity: mapDynamicParam(getObjc(presetItems, "opVr")),
      flow: mapDynamicParam(getObjc(presetItems, "prVr")),
    };
  }

  // Dual brush — useDualBrush lives inside the dualBrush sub-descriptor.
  // The secondary tip shape (Dmtr, Hrdn, etc.) is nested in dualBrush.Brsh.
  const dualItems = getObjc(presetItems, "dualBrush");
  if (dualItems) {
    const useDualBrush = getBool(dualItems, "useDualBrush");
    if (useDualBrush) {
      const mode = mapDualBrushMode(getEnum(dualItems, "Md  "));
      // Secondary tip shape is inside the nested Brsh descriptor
      const dualBrshItems = getObjc(dualItems, "Brsh");
      const dualDiameter = dualBrshItems ? getNumber(dualBrshItems, "Dmtr") : undefined;
      const dualHardness = dualBrshItems ? getNumber(dualBrshItems, "Hrdn") : undefined;
      // Spacing is at the dual brush level, not inside Brsh
      const dualSpacing = getNumber(dualItems, "Spcn");
      params.dualBrush = {
        enabled: true,
        mode,
        useComputed: true, // ABR dual brushes use computed tips by default
        hardness: dualHardness !== undefined ? dualHardness / 100 : 1.0,
        size: dualDiameter ?? 20,
        spacing: dualSpacing !== undefined ? dualSpacing / 100 : 0.25,
      };
    }
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
        const tipUuid = brsh ? getText(brsh, "sampledData") : undefined;
        presets.push({
          name,
          params: extractPresetParams(item.items),
          tipUuid,
        });
      }
    }
  } catch {
    // Skip on parse error
  }

  return { presets };
}

/**
 * Parse an ABR file and extract brush presets with tip images.
 */
export function parseAbrFile(buffer: ArrayBuffer): ParsedAbrBrush[] {
  const reader = new DataViewReader(buffer);

  if (reader.remaining < 4) return [];

  const version = reader.readU16();
  const subVersion = reader.readU16();

  // We only support version 6+ (Photoshop 7+)
  if (version < 6) return [];

  let sampEntries: SampEntry[] = [];
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
      sampEntries = parseSampSection(reader, sectionEnd, subVersion);
    } else if (sectionTag === "desc") {
      const { presets } = parseDescSection(reader, sectionEnd);
      descPresets = presets;
    }

    reader.seek(sectionEnd);
  }

  // Build UUID → samp entry lookup
  const sampByUuid = new Map<string, SampEntry>();
  for (const entry of sampEntries) {
    sampByUuid.set(entry.uuid, entry);
  }

  // If we have desc presets, use them for proper name/param/tip mapping.
  if (descPresets.length > 0) {
    const brushes: ParsedAbrBrush[] = [];
    for (const preset of descPresets) {
      const brush: ParsedAbrBrush = {
        name: preset.name,
        params: preset.params,
      };
      if (preset.tipUuid) {
        const samp = sampByUuid.get(preset.tipUuid);
        if (samp) {
          brush.imageData = samp.imageData;
          brush.width = samp.width;
          brush.height = samp.height;
        }
      }
      brushes.push(brush);
    }
    return brushes;
  }

  // Fallback: no desc section — return samp entries with default names
  return sampEntries.map((entry, i) => ({
    name: `Brush ${i + 1}`,
    imageData: entry.imageData,
    width: entry.width,
    height: entry.height,
  }));
}
