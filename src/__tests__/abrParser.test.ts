import { describe, it, expect } from "vitest";
import { parseAbrFile } from "../abrParser";

/** Helper to build big-endian binary data for ABR test fixtures. */
class BinaryBuilder {
  private parts: number[] = [];

  u8(v: number): this { this.parts.push(v & 0xff); return this; }
  u16(v: number): this { this.parts.push((v >> 8) & 0xff, v & 0xff); return this; }
  u32(v: number): this {
    this.parts.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
    return this;
  }
  i32(v: number): this { return this.u32(v >>> 0); }
  f64(v: number): this {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, v, false);
    this.parts.push(...new Uint8Array(buf));
    return this;
  }
  tag(s: string): this {
    for (let i = 0; i < 4; i++) this.parts.push(s.charCodeAt(i));
    return this;
  }
  /** Write a Unicode string with 4-byte length prefix (in char count including null). */
  unicodeString(s: string): this {
    this.u32(s.length + 1);
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    this.u16(0); // null terminator
    return this;
  }
  /** Write a ClassID: len=0 means 4-char tag. */
  classId(id: string): this {
    if (id.length === 4) {
      this.u32(0);
      this.tag(id);
    } else {
      this.u32(id.length);
      for (let i = 0; i < id.length; i++) this.parts.push(id.charCodeAt(i));
    }
    return this;
  }
  /** Write a key (same format as ClassID). */
  key(k: string): this { return this.classId(k); }
  /** Append raw bytes from another builder. */
  append(other: BinaryBuilder): this { this.parts.push(...other.parts); return this; }
  bytes(data: number[]): this { this.parts.push(...data); return this; }

  toArray(): number[] { return this.parts; }
  get length(): number { return this.parts.length; }
}

/** Build a UntF descriptor item. */
function untfItem(key: string, unit: string, value: number): BinaryBuilder {
  return new BinaryBuilder().key(key).tag("UntF").tag(unit).f64(value);
}

/** Build a bool descriptor item. */
function boolItem(key: string, value: boolean): BinaryBuilder {
  return new BinaryBuilder().key(key).tag("bool").u8(value ? 1 : 0);
}

/** Build a minimal samp section with one 2x2 brush. */
function buildSampSection(): BinaryBuilder {
  const sampleData = new BinaryBuilder()
    .u32(0) // misc
    .u32(0) // spacing
    .u8(0)  // antialiasing
    .u32(0).u32(0).u32(2).u32(2) // bounds: top, left, bottom, right
    .u16(0) // feature data
    .u16(8) // depth
    .u8(0)  // compression = raw
    .bytes([255, 255, 255, 255]); // 2x2 pixels

  const sampleBlock = new BinaryBuilder()
    .u32(sampleData.length)
    .append(sampleData);

  return new BinaryBuilder()
    .tag("8BIM").tag("samp")
    .u32(sampleBlock.length)
    .append(sampleBlock);
}

/** Build a desc section containing one descriptor with the given items. */
function buildDescSection(name: string, items: BinaryBuilder[]): BinaryBuilder {
  // Build the descriptor body
  const descriptorBody = new BinaryBuilder()
    .unicodeString(name)
    .classId("null") // classId
    .u32(items.length); // item count
  for (const item of items) {
    descriptorBody.append(item);
  }

  // Wrap in desc tag + size
  const descBlock = new BinaryBuilder()
    .tag("desc")
    .u32(descriptorBody.length)
    .append(descriptorBody);

  return new BinaryBuilder()
    .tag("8BIM").tag("desc")
    .u32(descBlock.length)
    .append(descBlock);
}

describe("abrParser", () => {
  it("returns empty array for empty buffer", () => {
    const result = parseAbrFile(new ArrayBuffer(0));
    expect(result).toEqual([]);
  });

  it("returns empty array for too-small buffer", () => {
    const result = parseAbrFile(new ArrayBuffer(2));
    expect(result).toEqual([]);
  });

  it("returns empty array for old ABR version (version < 6)", () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint16(0, 2, false); // version 2
    view.setUint16(2, 0, false); // sub-version
    const result = parseAbrFile(buf);
    expect(result).toEqual([]);
  });

  it("returns empty array for version 6 with no samp sections", () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint16(0, 6, false);
    view.setUint16(2, 1, false);
    const result = parseAbrFile(buf);
    expect(result).toEqual([]);
  });

  it("parses a minimal version 6 ABR with a samp section", () => {
    // Build a minimal ABR v6 file with one 2x2 uncompressed brush tip
    const parts: number[] = [];

    // Header: version=6, sub-version=1
    parts.push(0, 6, 0, 1);

    // 8BIM tag
    parts.push(0x38, 0x42, 0x49, 0x4d); // "8BIM"

    // Section tag: "samp"
    parts.push(0x73, 0x61, 0x6d, 0x70);

    // Section size (calculated below)
    // We'll fill this in after building the sample data

    // Build sample data
    const sampleData: number[] = [];

    // misc (4 bytes)
    sampleData.push(0, 0, 0, 0);
    // spacing (4 bytes)
    sampleData.push(0, 0, 0, 0);
    // antialiasing (1 byte)
    sampleData.push(0);
    // bounds: top=0, left=0, bottom=2, right=2
    sampleData.push(0, 0, 0, 0); // top
    sampleData.push(0, 0, 0, 0); // left
    sampleData.push(0, 0, 0, 2); // bottom
    sampleData.push(0, 0, 0, 2); // right
    // feature data (2 bytes)
    sampleData.push(0, 0);
    // depth = 8
    sampleData.push(0, 8);
    // compression = 0 (raw)
    sampleData.push(0);
    // Pixel data: 2x2 = 4 bytes, all white
    sampleData.push(255, 255, 255, 255);

    // Sample length (4 bytes big-endian)
    const sampleLength = sampleData.length;
    const sampleLenBytes = [
      (sampleLength >> 24) & 0xff,
      (sampleLength >> 16) & 0xff,
      (sampleLength >> 8) & 0xff,
      sampleLength & 0xff,
    ];

    // Full sample block = sample length prefix + sample data
    const fullSample = [...sampleLenBytes, ...sampleData];

    // Section size = full sample block length
    const sectionSize = fullSample.length;
    parts.push(
      (sectionSize >> 24) & 0xff,
      (sectionSize >> 16) & 0xff,
      (sectionSize >> 8) & 0xff,
      sectionSize & 0xff,
    );

    parts.push(...fullSample);

    const buf = new Uint8Array(parts).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].width).toBe(2);
    expect(result[0].height).toBe(2);
    expect(result[0].imageData.length).toBe(4);
    expect(result[0].imageData[0]).toBe(255);
  });

  it("extracts brush parameters from desc section", () => {
    // Build an ABR file: header + desc section (with params) + samp section
    const header = new BinaryBuilder().u16(6).u16(1);
    const desc = buildDescSection("Test Brush", [
      untfItem("Dmtr", "#Pxl", 45.0),   // diameter 45px
      untfItem("Hrdn", "#Prc", 75.0),   // hardness 75%
      untfItem("Spcn", "#Prc", 30.0),   // spacing 30%
      untfItem("Angl", "#Ang", 15.0),   // angle 15°
      untfItem("Rndn", "#Prc", 80.0),   // roundness 80%
      boolItem("flipX", true),
      boolItem("flipY", false),
    ]);
    const samp = buildSampSection();

    const data = new BinaryBuilder()
      .append(header)
      .append(desc)
      .append(samp);

    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Test Brush");
    expect(result[0].params).toBeDefined();
    expect(result[0].params!.diameter).toBeCloseTo(45.0);
    expect(result[0].params!.hardness).toBeCloseTo(0.75);
    expect(result[0].params!.spacing).toBeCloseTo(0.30);
    expect(result[0].params!.angle).toBeCloseTo(15.0);
    expect(result[0].params!.roundness).toBeCloseTo(0.80);
    expect(result[0].params!.flipX).toBe(true);
    expect(result[0].params!.flipY).toBe(false);
  });

  it("handles desc section with opacity and flow", () => {
    const header = new BinaryBuilder().u16(6).u16(1);
    const desc = buildDescSection("Soft Brush", [
      untfItem("Opct", "#Prc", 60.0),  // opacity 60%
      untfItem("Fl  ", "#Prc", 40.0),  // flow 40%
    ]);
    const samp = buildSampSection();

    const data = new BinaryBuilder()
      .append(header).append(desc).append(samp);

    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].params!.opacity).toBeCloseTo(0.60);
    expect(result[0].params!.flow).toBeCloseTo(0.40);
  });

  it("falls back to defaults when desc has no parameters", () => {
    const header = new BinaryBuilder().u16(6).u16(1);
    const desc = buildDescSection("Empty Brush", []);
    const samp = buildSampSection();

    const data = new BinaryBuilder()
      .append(header).append(desc).append(samp);

    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Empty Brush");
    // params should be an empty object (no values extracted)
    expect(result[0].params).toBeDefined();
    expect(result[0].params!.diameter).toBeUndefined();
    expect(result[0].params!.spacing).toBeUndefined();
  });
});
