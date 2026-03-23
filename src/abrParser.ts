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

import type { ShapeDynamics, TransferDynamics, DynamicParam, DynamicControl, DualBrushSettings, ScatterSettings, TextureSettings } from "./hooks/useBrushSettings";
import {
  DUAL_BRUSH_MODE_MULTIPLY,
  DUAL_BRUSH_MODE_DARKEN,
  DUAL_BRUSH_MODE_LIGHTEN,
  DUAL_BRUSH_MODE_SUBTRACT,
  DUAL_BRUSH_MODE_LINEAR_DODGE,
  DUAL_BRUSH_MODE_SCREEN,
} from "./hooks/useBrushSettings";
import {
  DataViewReader,
  type DescriptorValue,
  readDescriptor,
  getNumber,
  getBool,
  getObjc,
  getText,
  getEnum,
} from "./photoshopDescriptor";

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
  scatterSettings?: ScatterSettings;
  texture?: TextureSettings;
}

export interface ParsedAbrBrush {
  name: string;
  /** Image data for sampled brush tips. Undefined for computed (circle) tips. */
  imageData?: Uint8Array;
  /** Width of the tip image (only set for sampled tips). */
  width?: number;
  /** Height of the tip image (only set for sampled tips). */
  height?: number;
  /** Image data for a sampled dual brush tip. */
  dualImageData?: Uint8Array;
  /** Width of the dual brush tip image. */
  dualWidth?: number;
  /** Height of the dual brush tip image. */
  dualHeight?: number;
  /** Texture pattern image data (grayscale). */
  textureImageData?: Uint8Array;
  /** Width of the texture pattern. */
  textureWidth?: number;
  /** Height of the texture pattern. */
  textureHeight?: number;
  /** Brush parameters extracted from ABR descriptor section. */
  params?: AbrBrushParams;
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

/** A pattern image extracted from a `patt` section. */
interface PattEntry {
  uuid: string;
  imageData: Uint8Array;
  width: number;
  height: number;
}

/**
 * Parse a `patt` section to extract embedded pattern images keyed by UUID.
 *
 * Each pattern entry contains:
 *  - u32: entry byte length
 *  - u32: version (1)
 *  - u32: image mode (1=Grayscale, 3=RGB, etc.)
 *  - u16: height, u16: width
 *  - Unicode string: pattern name
 *  - Pascal string: unique ID (UUID)
 *  - VirtualMemoryArrayList: channel pixel data (version 3)
 *
 * We only extract the first written channel as an 8-bit grayscale image.
 */
function parsePattSection(
  reader: DataViewReader,
  endPos: number,
): PattEntry[] {
  const entries: PattEntry[] = [];

  while (reader.position < endPos) {
    if (reader.remaining < 4) break;
    const entryLen = reader.readU32();
    if (entryLen === 0 || reader.position + entryLen > endPos) break;
    const entryEnd = reader.position + entryLen;

    try {
      const version = reader.readU32();
      if (version !== 1) { reader.seek(entryEnd); continue; }

      const imageMode = reader.readU32();
      const height = reader.readU16();
      const width = reader.readU16();

      // Unicode name: u32 char count, then UTF-16BE data
      const nameLen = reader.readU32();
      reader.skip(nameLen * 2);

      // Unique ID as Pascal-style string with NO padding after
      const idLen = reader.readU8();
      const idBytes = reader.readBytes(idLen);
      const uuid = new TextDecoder("ascii").decode(idBytes);

      // Only support grayscale patterns (mode=1) for brush textures
      if (imageMode !== 1 || width === 0 || height === 0) {
        reader.seek(entryEnd);
        continue;
      }

      // VirtualMemoryArrayList — version 3
      const vmaVersion = reader.readU32();
      if (vmaVersion !== 3) { reader.seek(entryEnd); continue; }
      reader.skip(4); // VMA length
      reader.skip(16); // VMA rect (top, left, bottom, right as u32)
      const numChannels = reader.readU32();

      // Find first written channel and extract pixel data
      let imageData: Uint8Array | undefined;
      for (let ch = 0; ch < numChannels; ch++) {
        if (reader.position + 4 > entryEnd) break;
        const isWritten = reader.readU32();
        if (!isWritten) continue;

        const chLength = reader.readU32();
        const chDataEnd = reader.position + chLength;
        // Channel header: depth(u32=4) + rect(u32×4=16) + compression(u16=2)
        reader.skip(4 + 16 + 2);
        const headerSize = 22;
        const dataBytes = chLength - headerSize;
        const pixelCount = width * height;
        // Pixel data occupies the last pixelCount bytes; skip any leading padding
        const padding = Math.max(0, dataBytes - pixelCount);
        reader.skip(padding);
        if (pixelCount > 0 && reader.position + pixelCount <= entryEnd + 4) {
          imageData = new Uint8Array(reader.readBytes(pixelCount));
        }
        reader.seek(chDataEnd);
        if (imageData) break;
      }

      if (imageData) {
        entries.push({ uuid, imageData, width, height });
      }
    } catch {
      // Skip on parse error
    }

    reader.seek(entryEnd);
    // Pad to even boundary
    if (reader.position % 2 !== 0) reader.skip(1);
  }

  return entries;
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
  // bVTy: 0=Off, 1=Fade, 2=PenPressure, 3=PenTilt, 4=StylusWheel, 5=Direction, 6=InitialDirection
  let control: DynamicControl = 0;
  if (bVTy === 2) {
    control = 1; // Pen Pressure
  } else if (bVTy === 5) {
    control = 3; // Direction
  } else if (bVTy === 6) {
    control = 4; // Initial Direction
  }

  return { jitter, control, minimum };
}

/** Parsed info for a single preset from the desc section. */
interface ParsedPresetInfo {
  name: string;
  params: AbrBrushParams;
  /** UUID of the sampled tip, or undefined for computed tips. */
  tipUuid?: string;
  /** UUID of the dual brush's sampled tip, or undefined when computed. */
  dualTipUuid?: string;
  /** UUID of the texture pattern from the Txtr descriptor. */
  texturePatternId?: string;
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

  // Scatter settings
  const useScatter = getBool(presetItems, "useScatter");
  if (useScatter) {
    const scatter = getNumber(presetItems, "Sctr");
    const count = getNumber(presetItems, "Cnt ");
    const bothAxes = getBool(presetItems, "BthA");
    const countJitter = getNumber(presetItems, "CntJ");
    params.scatterSettings = {
      scatter: scatter !== undefined ? scatter / 100 : 0,
      count: count ?? 1,
      bothAxes: bothAxes ?? false,
      countJitter: countJitter !== undefined ? countJitter / 100 : 0,
    };
  }

  // Texture settings
  const useTexture = getBool(presetItems, "useTexture");
  if (useTexture) {
    const txScale = getNumber(presetItems, "Scl ");
    const txDepth = getNumber(presetItems, "textureDepth");
    const texEachTip = getBool(presetItems, "textureEachTip");
    params.texture = {
      enabled: true,
      scale: txScale !== undefined ? txScale : 100,
      depth: txDepth !== undefined ? txDepth / 100 : 1.0,
      textureEachTip: texEachTip ?? false,
    };
  }

  // Dual brush — useDualBrush lives inside the dualBrush sub-descriptor.
  // The secondary tip shape (Dmtr, Hrdn, etc.) is nested in dualBrush.Brsh.
  const dualItems = getObjc(presetItems, "dualBrush");
  if (dualItems) {
    const useDualBrush = getBool(dualItems, "useDualBrush");
    if (useDualBrush) {
      const mode = mapDualBrushMode(getEnum(dualItems, "BlnM"));
      // Secondary tip shape is inside the nested Brsh descriptor
      const dualBrshItems = getObjc(dualItems, "Brsh");
      const dualDiameter = dualBrshItems ? getNumber(dualBrshItems, "Dmtr") : undefined;
      const dualHardness = dualBrshItems ? getNumber(dualBrshItems, "Hrdn") : undefined;
      const dualSpacing = dualBrshItems ? getNumber(dualBrshItems, "Spcn") : undefined;
      const dualHasSampledTip = dualBrshItems ? getText(dualBrshItems, "sampledData") !== undefined : false;
      const dualCount = getNumber(dualItems, "Cnt ");
      const dualScatter = getNumber(dualItems, "Sctr");
      const dualBothAxes = getBool(dualItems, "BthA");
      params.dualBrush = {
        enabled: true,
        mode,
        useComputed: !dualHasSampledTip,
        hardness: dualHardness !== undefined ? dualHardness / 100 : 1.0,
        sizeRatio: dualDiameter !== undefined ? (dualDiameter / (params.diameter ?? 20)) : 1.0,
        spacing: dualSpacing !== undefined ? dualSpacing / 100 : 0.25,
        count: dualCount ?? 1,
        scatter: dualScatter !== undefined ? dualScatter / 100 : 0,
        bothAxes: dualBothAxes ?? false,
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

        // Dual brush may also reference a sampled tip
        const dualItems = getObjc(item.items, "dualBrush");
        let dualTipUuid: string | undefined;
        if (dualItems) {
          const dualBrsh = getObjc(dualItems, "Brsh");
          if (dualBrsh) {
            dualTipUuid = getText(dualBrsh, "sampledData");
          }
        }

        // Texture pattern UUID from the Txtr descriptor's Idnt field
        const txtrItems = getObjc(item.items, "Txtr");
        const texturePatternId = txtrItems ? getText(txtrItems, "Idnt") : undefined;

        presets.push({
          name,
          params: extractPresetParams(item.items),
          tipUuid,
          dualTipUuid,
          texturePatternId,
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
  let pattEntries: PattEntry[] = [];
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
    } else if (sectionTag === "patt") {
      pattEntries = parsePattSection(reader, sectionEnd);
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

  // Build UUID → patt entry lookup
  const pattByUuid = new Map<string, PattEntry>();
  for (const entry of pattEntries) {
    pattByUuid.set(entry.uuid, entry);
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
      if (preset.dualTipUuid) {
        const dualSamp = sampByUuid.get(preset.dualTipUuid);
        if (dualSamp) {
          brush.dualImageData = dualSamp.imageData;
          brush.dualWidth = dualSamp.width;
          brush.dualHeight = dualSamp.height;
        }
      }
      if (preset.texturePatternId) {
        const patt = pattByUuid.get(preset.texturePatternId);
        if (patt) {
          brush.textureImageData = patt.imageData;
          brush.textureWidth = patt.width;
          brush.textureHeight = patt.height;
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
