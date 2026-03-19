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

export interface ParsedAbrBrush {
  name: string;
  imageData: Uint8Array;
  width: number;
  height: number;
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
 */
function parseSampSection(
  reader: DataViewReader,
  endPos: number,
): ParsedAbrBrush[] {
  const brushes: ParsedAbrBrush[] = [];

  while (reader.position + 4 < endPos) {
    if (reader.remaining < 4) break;

    const sampleLength = reader.readU32();
    if (sampleLength === 0) break;

    const sampleEnd = reader.position + sampleLength;
    if (sampleEnd > endPos) break;

    // Skip misc field (4 bytes) and spacing (4 bytes)
    reader.skip(4); // misc
    reader.skip(4); // spacing

    // Skip antialiasing (unused tag)
    reader.skip(reader.position + 1 <= sampleEnd ? 1 : 0);

    // Read bounds: top, left, bottom, right (each 4 bytes)
    const _boundsTop = reader.readU32();
    const _boundsLeft = reader.readU32();
    const boundsBottom = reader.readU32();
    const boundsRight = reader.readU32();

    // Skip feature data
    reader.skip(reader.position + 2 <= sampleEnd ? 2 : 0);

    const depth = reader.readU16();
    const compression = reader.readU8();

    const width = boundsRight - _boundsLeft;
    const height = boundsBottom - _boundsTop;

    if (width === 0 || height === 0 || width > 8192 || height > 8192) {
      reader.seek(sampleEnd);
      continue;
    }

    let imageData: Uint8Array;
    if (compression === 0) {
      // Raw data
      const bytesPerPixel = depth === 16 ? 2 : 1;
      const rawSize = width * height * bytesPerPixel;
      if (reader.remaining < rawSize) {
        reader.seek(sampleEnd);
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
      reader.seek(sampleEnd);
      continue;
    }

    brushes.push({
      name: `Brush ${brushes.length + 1}`,
      imageData,
      width,
      height,
    });

    reader.seek(sampleEnd);
  }

  return brushes;
}

/**
 * Parse a `desc` section to extract brush names.
 */
function parseDescNames(
  reader: DataViewReader,
  endPos: number,
): string[] {
  const names: string[] = [];

  while (reader.position + 4 < endPos) {
    const tag = reader.readTag();
    const size = reader.readU32();
    const sectionEnd = reader.position + size;

    if (tag === "desc" && size > 0) {
      try {
        // Descriptor: class name unicode string, then classID
        const descriptorName = reader.readUnicodeString();
        if (descriptorName.length > 0) {
          names.push(descriptorName);
        }
      } catch {
        // Skip on parse error
      }
    }

    reader.seek(sectionEnd);
  }

  return names;
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

  // Version 6+ files have tagged sections
  // Skip the rest of the sub-version header area
  // Look for 8BIM resource sections
  const brushes: ParsedAbrBrush[] = [];
  const names: string[] = [];

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
      const parsed = parseSampSection(reader, sectionEnd);
      brushes.push(...parsed);
    } else if (sectionTag === "desc") {
      const parsedNames = parseDescNames(reader, sectionEnd);
      names.push(...parsedNames);
    }

    reader.seek(sectionEnd);
  }

  // Apply names to brushes
  for (let i = 0; i < brushes.length && i < names.length; i++) {
    brushes[i].name = names[i];
  }

  return brushes;
}
