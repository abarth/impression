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
  /** Pad with zeros to reach a target length. */
  padTo(targetLength: number): this {
    while (this.parts.length < targetLength) this.parts.push(0);
    return this;
  }

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

/**
 * Build a minimal samp section with one 2x2 brush.
 * Sub-version 1 skips 47 bytes, then reads bounds/depth/compression/pixels.
 */
function buildSampSection(): BinaryBuilder {
  const sampleData = new BinaryBuilder()
    .padTo(47) // 47-byte opaque header blob (sub-version 1)
    .i32(0).i32(0).i32(2).i32(2) // bounds: top, left, bottom, right
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

/**
 * Build a desc section with a VlLs of brushPreset descriptors.
 * Each preset has a name and brush params in a nested "Brsh" object.
 * Format: 4-byte version + single descriptor with "Brsh" VlLs.
 */
function buildDescSection(presets: { name: string; isSampled: boolean; items: BinaryBuilder[] }[]): BinaryBuilder {
  // Build each preset as an Objc descriptor
  const presetObjcs: BinaryBuilder[] = [];
  for (const preset of presets) {
    // Build the "Brsh" sub-descriptor (computedBrush or sampledBrush)
    const brshClassName = preset.isSampled ? "sampledBrush" : "computedBrush";
    const brshItems = [...preset.items];
    if (preset.isSampled) {
      // Add sampledData TEXT to mark it as sampled
      brshItems.push(
        new BinaryBuilder().key("sampledData").tag("TEXT").unicodeString("fake-uuid-1234"),
      );
    }

    const brshDesc = new BinaryBuilder()
      .unicodeString("")
      .classId(brshClassName)
      .u32(brshItems.length);
    for (const item of brshItems) brshDesc.append(item);

    // Build the preset descriptor items: Nm (name) + Brsh (nested descriptor)
    const presetDesc = new BinaryBuilder()
      .unicodeString("")
      .classId("brushPreset")
      .u32(2) // 2 items: Nm + Brsh
      .key("Nm  ").tag("TEXT").unicodeString(preset.name)
      .key("Brsh").tag("Objc").append(brshDesc);

    presetObjcs.push(presetDesc);
  }

  // Build VlLs of presets
  const vlls = new BinaryBuilder().u32(presetObjcs.length);
  for (const obj of presetObjcs) {
    vlls.tag("Objc").append(obj);
  }

  // Build top-level descriptor: single item "Brsh" → VlLs
  const topDescriptor = new BinaryBuilder()
    .unicodeString("")
    .classId("null")
    .u32(1) // 1 item
    .key("Brsh").tag("VlLs").append(vlls);

  // desc section = 4-byte version + descriptor
  const descContent = new BinaryBuilder()
    .u32(16) // version
    .append(topDescriptor);

  return new BinaryBuilder()
    .tag("8BIM").tag("desc")
    .u32(descContent.length)
    .append(descContent);
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
    const header = new BinaryBuilder().u16(6).u16(1);
    const samp = buildSampSection();

    const data = new BinaryBuilder().append(header).append(samp);
    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].width).toBe(2);
    expect(result[0].height).toBe(2);
    expect(result[0].imageData.length).toBe(4);
    expect(result[0].imageData[0]).toBe(255);
  });

  it("extracts brush parameters from desc section", () => {
    const header = new BinaryBuilder().u16(6).u16(1);
    const desc = buildDescSection([{
      name: "Test Brush",
      isSampled: true,
      items: [
        untfItem("Dmtr", "#Pxl", 45.0),
        untfItem("Hrdn", "#Prc", 75.0),
        untfItem("Spcn", "#Prc", 30.0),
        untfItem("Angl", "#Ang", 15.0),
        untfItem("Rndn", "#Prc", 80.0),
        boolItem("flipX", true),
        boolItem("flipY", false),
      ],
    }]);
    const samp = buildSampSection();

    const data = new BinaryBuilder()
      .append(header).append(desc).append(samp);

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

  it("handles desc section with opacity and flow in toolOptions", () => {
    // Build a preset with opacity/flow in a nested toolOptions descriptor
    const toolOptsDesc = new BinaryBuilder()
      .unicodeString("")
      .classId("PbTl")
      .u32(2) // 2 items
      .key("Opct").tag("long").i32(60)
      .key("flow").tag("long").i32(40);

    const header = new BinaryBuilder().u16(6).u16(1);

    // Manually build the desc section with toolOptions
    const presetDesc = new BinaryBuilder()
      .unicodeString("")
      .classId("brushPreset")
      .u32(3) // 3 items: Nm + Brsh + toolOptions
      .key("Nm  ").tag("TEXT").unicodeString("Soft Brush")
      .key("Brsh").tag("Objc")
        .unicodeString("").classId("sampledBrush").u32(1)
        .key("sampledData").tag("TEXT").unicodeString("fake-uuid")
      .key("toolOptions").tag("Objc").append(toolOptsDesc);

    const vlls = new BinaryBuilder()
      .u32(1) // 1 preset
      .tag("Objc").append(presetDesc);

    const topDescriptor = new BinaryBuilder()
      .unicodeString("").classId("null")
      .u32(1).key("Brsh").tag("VlLs").append(vlls);

    const descContent = new BinaryBuilder().u32(16).append(topDescriptor);
    const descSection = new BinaryBuilder()
      .tag("8BIM").tag("desc")
      .u32(descContent.length).append(descContent);

    const samp = buildSampSection();
    const data = new BinaryBuilder()
      .append(header).append(descSection).append(samp);

    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].params!.opacity).toBeCloseTo(0.60);
    expect(result[0].params!.flow).toBeCloseTo(0.40);
  });

  it("falls back to defaults when desc has no parameters", () => {
    const header = new BinaryBuilder().u16(6).u16(1);
    const desc = buildDescSection([{
      name: "Empty Brush",
      isSampled: true,
      items: [],
    }]);
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

  it("maps sampled presets to samp entries, skipping computed presets", () => {
    const header = new BinaryBuilder().u16(6).u16(1);

    // 3 presets in desc: computed, sampled, sampled
    const desc = buildDescSection([
      { name: "Hard Round", isSampled: false, items: [untfItem("Hrdn", "#Prc", 100.0)] },
      { name: "Textured 1", isSampled: true, items: [untfItem("Dmtr", "#Pxl", 30.0)] },
      { name: "Textured 2", isSampled: true, items: [untfItem("Dmtr", "#Pxl", 50.0)] },
    ]);

    // 2 samp entries (matching the 2 sampled presets)
    // Entry data must be padded so that (4 + dataLen) aligns to 4 bytes
    const samp1 = new BinaryBuilder()
      .padTo(47).i32(0).i32(0).i32(2).i32(2).u16(8).u8(0)
      .bytes([100, 100, 100, 100])
      .padTo(72); // 72 + 4 (length prefix) = 76 bytes, aligned to 4
    const samp2 = new BinaryBuilder()
      .padTo(47).i32(0).i32(0).i32(3).i32(3).u16(8).u8(0)
      .bytes([200, 200, 200, 200, 200, 200, 200, 200, 200]);

    const sampBlock = new BinaryBuilder()
      .u32(samp1.length).append(samp1)
      .u32(samp2.length).append(samp2);

    const sampSection = new BinaryBuilder()
      .tag("8BIM").tag("samp")
      .u32(sampBlock.length).append(sampBlock);

    const data = new BinaryBuilder()
      .append(header).append(desc).append(sampSection);

    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(2);
    expect(result[0].name).toBe("Textured 1");
    expect(result[0].params!.diameter).toBeCloseTo(30.0);
    expect(result[0].width).toBe(2);
    expect(result[1].name).toBe("Textured 2");
    expect(result[1].params!.diameter).toBeCloseTo(50.0);
    expect(result[1].width).toBe(3);
  });
});
