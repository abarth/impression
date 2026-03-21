/**
 * GRD (Adobe Gradient) file parser.
 *
 * Parses Photoshop .grd gradient preset files. These use the same "8BIM"
 * section + descriptor format as ABR files.
 *
 * GRD files contain a list of gradient presets, each with:
 * - Color stops (position, color, midpoint)
 * - Transparency/opacity stops (position, opacity, midpoint)
 * - Gradient form (solid stops or noise)
 * - Smoothness/interpolation
 *
 * References:
 * - https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/
 * - https://github.com/nickyout/gradient-parser-grd
 */

import type { Gradient, ColorStop, OpacityStop } from "./gradient";
import {
  DataViewReader,
  type DescriptorValue,
  readDescriptor,
  getNumber,
  getObjc,
  getText,
  getEnum,
  getList,
} from "./photoshopDescriptor";

/** Intermediate parsed gradient from GRD (before assigning IDs). */
export interface ParsedGrdGradient {
  name: string;
  colorStops: ColorStop[];
  opacityStops: OpacityStop[];
  smoothness: number;
  form: "solid" | "noise";
}

/**
 * Extract an RGB color from a Photoshop color descriptor.
 *
 * Photoshop stores colors in various models: "RGBC" (RGB), "HSBC" (HSB),
 * "LbCl" (Lab), "CMYC" (CMYK), "Grsc" (Grayscale), "BkCl" (Book Color).
 * We convert all to hex RGB.
 */
function extractColor(
  items: Map<string, DescriptorValue>,
): string {
  // Try RGB first (most common): "Rd  ", "Grn ", "Bl  " as 0-255 floats
  const r = getNumber(items, "Rd  ");
  const g = getNumber(items, "Grn ");
  const b = getNumber(items, "Bl  ");
  if (r !== undefined && g !== undefined && b !== undefined) {
    return rgbToHex(Math.round(r), Math.round(g), Math.round(b));
  }

  // HSB: "H   " (0-360), "Strt" (0-100), "Brgh" (0-100)
  const h = getNumber(items, "H   ");
  const s = getNumber(items, "Strt");
  const v = getNumber(items, "Brgh");
  if (h !== undefined && s !== undefined && v !== undefined) {
    return hsbToHex(h, s / 100, v / 100);
  }

  // Lab: "Lmnc" (0-100), "A   " (-128 to 127), "B   " (-128 to 127)
  const lum = getNumber(items, "Lmnc");
  const labA = getNumber(items, "A   ");
  const labB = getNumber(items, "B   ");
  if (lum !== undefined && labA !== undefined && labB !== undefined) {
    return labToHex(lum, labA, labB);
  }

  // Grayscale: "Gry " (0-100) or "Bk  " (0-100)
  const gray = getNumber(items, "Gry ");
  if (gray !== undefined) {
    const v8 = Math.round((gray / 100) * 255);
    return rgbToHex(v8, v8, v8);
  }
  const bk = getNumber(items, "Bk  ");
  if (bk !== undefined) {
    const v8 = Math.round(((100 - bk) / 100) * 255);
    return rgbToHex(v8, v8, v8);
  }

  return "#000000"; // fallback
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) =>
    Math.max(0, Math.min(255, v))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

/** Convert HSB (hue 0-360, saturation 0-1, brightness 0-1) to hex. */
function hsbToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return rgbToHex(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  );
}

/** Convert CIE Lab to hex (approximate D65 illuminant). */
function labToHex(l: number, a: number, b: number): string {
  // Lab → XYZ (D65)
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const delta = 6 / 29;
  const invF = (t: number) =>
    t > delta ? t * t * t : 3 * delta * delta * (t - 4 / 29);

  // D65 reference white
  const x = 0.95047 * invF(fx);
  const y = 1.0 * invF(fy);
  const z = 1.08883 * invF(fz);

  // XYZ → sRGB
  let rr = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  let gg = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  let bb = 0.055 * x - 0.204 * y + 1.057 * z;

  // Gamma
  const gamma = (v: number) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  rr = gamma(Math.max(0, rr));
  gg = gamma(Math.max(0, gg));
  bb = gamma(Math.max(0, bb));

  return rgbToHex(
    Math.round(rr * 255),
    Math.round(gg * 255),
    Math.round(bb * 255),
  );
}

/**
 * Parse a single gradient descriptor into our Gradient model.
 *
 * Photoshop gradient descriptor keys:
 * - "Nm  " → name
 * - "GrdF" → form enum ("CstS" = solid/custom stops, "ClNs" = color noise)
 * - "Intr" → interpolation/smoothness (0-4096, we map to 0-100)
 * - "Clrs" → VlLs of color stop descriptors
 *   - "Clr " → Objc with color channels
 *   - "Type" → enum ("UsrS" user stop, "FrgC" foreground, "BckC" background)
 *   - "Lctn" → position (0-4096)
 *   - "Mdpn" → midpoint (0-100, percentage)
 * - "Trns" → VlLs of transparency stop descriptors
 *   - "Opct" → opacity (UntF, 0-100%)
 *   - "Lctn" → position (0-4096)
 *   - "Mdpn" → midpoint (0-100, percentage)
 */
function parseGradientDescriptor(
  items: Map<string, DescriptorValue>,
): ParsedGrdGradient | null {
  const name = getText(items, "Nm  ") ?? "Untitled";

  // Gradient form
  const formEnum = getEnum(items, "GrdF");
  const form: "solid" | "noise" = formEnum === "ClNs" ? "noise" : "solid";

  // Smoothness (Photoshop uses 0-4096 internally)
  const intr = getNumber(items, "Intr");
  const smoothness = intr !== undefined ? Math.round((intr / 4096) * 100) : 100;

  if (form === "noise") {
    // Noise gradients are procedural; we parse the name but skip complex generation
    return { name, colorStops: [], opacityStops: [], smoothness, form };
  }

  // Parse color stops
  const colorStops: ColorStop[] = [];
  const clrsValues = getList(items, "Clrs");
  if (clrsValues) {
    for (const stopVal of clrsValues) {
      if (stopVal.type !== "Objc") continue;
      const stopItems = stopVal.items;

      const lctn = getNumber(stopItems, "Lctn");
      const mdpn = getNumber(stopItems, "Mdpn");
      const colorObj = getObjc(stopItems, "Clr ");

      if (lctn === undefined) continue;

      const position = lctn / 4096;
      const midpoint = mdpn !== undefined ? mdpn / 100 : 0.5;
      const color = colorObj ? extractColor(colorObj) : "#000000";

      colorStops.push({ position, color, midpoint });
    }
  }

  // Parse transparency/opacity stops
  const opacityStops: OpacityStop[] = [];
  const trnsValues = getList(items, "Trns");
  if (trnsValues) {
    for (const stopVal of trnsValues) {
      if (stopVal.type !== "Objc") continue;
      const stopItems = stopVal.items;

      const lctn = getNumber(stopItems, "Lctn");
      const mdpn = getNumber(stopItems, "Mdpn");
      const opct = getNumber(stopItems, "Opct");

      if (lctn === undefined) continue;

      const position = lctn / 4096;
      const midpoint = mdpn !== undefined ? mdpn / 100 : 0.5;
      const opacity = opct !== undefined ? opct / 100 : 1;

      opacityStops.push({ position, opacity, midpoint });
    }
  }

  // Ensure at least one stop of each type
  if (colorStops.length === 0) {
    colorStops.push({ position: 0, color: "#000000", midpoint: 0.5 });
    colorStops.push({ position: 1, color: "#ffffff", midpoint: 0.5 });
  }
  if (opacityStops.length === 0) {
    opacityStops.push({ position: 0, opacity: 1, midpoint: 0.5 });
    opacityStops.push({ position: 1, opacity: 1, midpoint: 0.5 });
  }

  return { name, colorStops, opacityStops, smoothness, form };
}

/**
 * Parse a GRD file and extract gradient presets.
 *
 * GRD file structure:
 * - 4 bytes: "8BGR" magic (Photoshop resource file)
 * - 2 bytes: version (typically 5)
 * - Then a top-level descriptor with:
 *   - "GrSt" (gradient set) key containing a VlLs of gradient descriptors
 *
 * Alternative format (older):
 * - Starts with "8BIM" sections similar to ABR
 */
export function parseGrdFile(buffer: ArrayBuffer): ParsedGrdGradient[] {
  const reader = new DataViewReader(buffer);
  const gradients: ParsedGrdGradient[] = [];

  if (reader.remaining < 4) return [];

  // Check for the "8BGR" magic
  const magic = reader.readTag();

  if (magic === "8BGR") {
    // Modern GRD format: version + U32 padding + descriptor
    const version = reader.readU16();
    if (version < 5) return [];
    reader.skip(4); // skip unknown U32 field after version

    try {
      const descriptor = readDescriptor(reader, reader.position + reader.remaining);

      // Try "GrSt" → "Grdn" (some files) or direct "GrdL" key (other files)
      let gradList: DescriptorValue[] | undefined;
      const grstItems = getObjc(descriptor.items, "GrSt");
      if (grstItems) {
        gradList = getList(grstItems, "Grdn");
      }
      if (!gradList) {
        gradList = getList(descriptor.items, "GrdL");
      }
      if (!gradList) return [];

      for (const item of gradList) {
        if (item.type !== "Objc") continue;
        const parsed = parseGradientDescriptor(item.items);
        if (parsed) gradients.push(parsed);
      }
    } catch {
      // Parse error — return what we have
    }
  } else {
    // Try "8BIM" section format (like ABR)
    reader.seek(0);
    try {
      while (reader.remaining >= 12) {
        const tag = reader.readTag();
        if (tag !== "8BIM") {
          reader.skip(-3);
          continue;
        }

        const sectionTag = reader.readTag();
        const sectionSize = reader.readU32();
        const sectionEnd = reader.position + sectionSize;

        if (sectionEnd > reader.position + reader.remaining) break;

        if (sectionTag === "patt" || sectionTag === "desc") {
          // Skip version prefix
          reader.skip(4);
          const descriptor = readDescriptor(reader, sectionEnd);

          const gradList = getList(descriptor.items, "Grdn");
          if (gradList) {
            for (const item of gradList) {
              if (item.type !== "Objc") continue;
              const parsed = parseGradientDescriptor(item.items);
              if (parsed) gradients.push(parsed);
            }
          }
        }

        reader.seek(sectionEnd);
      }
    } catch {
      // Parse error
    }
  }

  return gradients;
}

/**
 * Convert parsed GRD gradients to our Gradient model with IDs.
 */
export function convertParsedGradients(
  parsed: ParsedGrdGradient[],
  group: string,
  startSortOrder: number = 0,
): Gradient[] {
  return parsed
    .filter((g) => g.form === "solid" && g.colorStops.length > 0)
    .map((g, i) => ({
      id: crypto.randomUUID(),
      name: g.name,
      group,
      colorStops: g.colorStops,
      opacityStops: g.opacityStops,
      smoothness: g.smoothness,
      sort_order: startSortOrder + i,
    }));
}
