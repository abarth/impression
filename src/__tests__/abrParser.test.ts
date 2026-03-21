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
  /** Write a Pascal string (1-byte length prefix, padded to even). */
  pascalString(s: string): this {
    this.u8(s.length);
    for (let i = 0; i < s.length; i++) this.parts.push(s.charCodeAt(i));
    if ((s.length + 1) % 2 !== 0) this.u8(0); // pad to even
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

/** Build a long descriptor item. */
function longItem(key: string, value: number): BinaryBuilder {
  return new BinaryBuilder().key(key).tag("long").i32(value);
}

/** Build an enum descriptor item. */
function enumItem(key: string, enumType: string, value: string): BinaryBuilder {
  return new BinaryBuilder().key(key).tag("enum").classId(enumType).classId(value);
}

/**
 * Build a samp section with entries. Each entry uses a 47-byte header (sub-version 1).
 * For sub-version 2, supply uuids and use 301-byte headers with Pascal string prefix.
 */
function buildSampSection(
  entries: { width: number; height: number; pixels: number[]; uuid?: string }[],
  subVersion: number = 1,
): BinaryBuilder {
  const skipBytes = subVersion >= 2 ? 301 : 47;
  const sampBlock = new BinaryBuilder();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const entryData = new BinaryBuilder();
    if (subVersion >= 2 && e.uuid) {
      // Write Pascal string UUID at the start, then pad to 301
      entryData.pascalString(e.uuid);
    }
    entryData.padTo(skipBytes);
    entryData
      .i32(0).i32(0).i32(e.height).i32(e.width) // bounds: top, left, bottom, right
      .u16(8) // depth
      .u8(0)  // compression = raw
      .bytes(e.pixels);

    // Pad entry data to align (4 + dataLen) to 4 bytes
    const totalWithLen = 4 + entryData.length;
    const aligned = (totalWithLen + 3) & ~3;
    entryData.padTo(aligned - 4);

    sampBlock.u32(entryData.length).append(entryData);
  }

  return new BinaryBuilder()
    .tag("8BIM").tag("samp")
    .u32(sampBlock.length)
    .append(sampBlock);
}

/**
 * Build a desc section with a VlLs of brushPreset descriptors.
 * Format: 4-byte version + single descriptor with "Brsh" VlLs.
 */
function buildDescSection(presets: {
  name: string;
  tipUuid?: string;
  brushItems?: BinaryBuilder[];
  presetItems?: BinaryBuilder[];
}[]): BinaryBuilder {
  const presetObjcs: BinaryBuilder[] = [];
  for (const preset of presets) {
    const brshClassName = preset.tipUuid ? "sampledBrush" : "computedBrush";
    const brshItems = [...(preset.brushItems ?? [])];
    if (preset.tipUuid) {
      brshItems.push(
        new BinaryBuilder().key("sampledData").tag("TEXT").unicodeString(preset.tipUuid),
      );
    }

    const brshDesc = new BinaryBuilder()
      .unicodeString("")
      .classId(brshClassName)
      .u32(brshItems.length);
    for (const item of brshItems) brshDesc.append(item);

    // Preset items: Nm + Brsh + any additional items
    const allPresetItems = [
      new BinaryBuilder().key("Nm  ").tag("TEXT").unicodeString(preset.name),
      new BinaryBuilder().key("Brsh").tag("Objc").append(brshDesc),
      ...(preset.presetItems ?? []),
    ];

    const presetDesc = new BinaryBuilder()
      .unicodeString("")
      .classId("brushPreset")
      .u32(allPresetItems.length);
    for (const item of allPresetItems) presetDesc.append(item);

    presetObjcs.push(presetDesc);
  }

  const vlls = new BinaryBuilder().u32(presetObjcs.length);
  for (const obj of presetObjcs) {
    vlls.tag("Objc").append(obj);
  }

  const topDescriptor = new BinaryBuilder()
    .unicodeString("").classId("null")
    .u32(1).key("Brsh").tag("VlLs").append(vlls);

  const descContent = new BinaryBuilder().u32(16).append(topDescriptor);

  return new BinaryBuilder()
    .tag("8BIM").tag("desc")
    .u32(descContent.length).append(descContent);
}

/** Build a brVr (brush variation) descriptor. */
function buildBrVr(bVTy: number, jitter: number, minimum: number = 0): BinaryBuilder {
  return new BinaryBuilder()
    .unicodeString("").classId("brVr")
    .u32(3) // 3 items
    .append(longItem("bVTy", bVTy))
    .append(untfItem("jitter", "#Prc", jitter))
    .append(untfItem("Mnm ", "#Prc", minimum));
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
    view.setUint16(0, 2, false);
    view.setUint16(2, 0, false);
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

  it("parses samp-only file with default names", () => {
    const header = new BinaryBuilder().u16(6).u16(1);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255] },
    ]);

    const data = new BinaryBuilder().append(header).append(samp);
    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Brush 1");
    expect(result[0].width).toBe(2);
    expect(result[0].height).toBe(2);
    expect(result[0].imageData!.length).toBe(4);
    expect(result[0].imageData![0]).toBe(255);
  });

  it("maps sampled presets to samp entries by UUID", () => {
    const header = new BinaryBuilder().u16(6).u16(2);

    // samp entries in arbitrary order (not matching desc preset order)
    const samp = buildSampSection([
      { width: 3, height: 3, pixels: new Array(9).fill(100), uuid: "uuid-B" },
      { width: 2, height: 2, pixels: [200, 200, 200, 200], uuid: "uuid-A" },
    ], 2);

    // desc presets reference UUIDs in different order
    const desc = buildDescSection([
      { name: "Brush A", tipUuid: "uuid-A", brushItems: [untfItem("Dmtr", "#Pxl", 20)] },
      { name: "Brush B", tipUuid: "uuid-B", brushItems: [untfItem("Dmtr", "#Pxl", 30)] },
    ]);

    const data = new BinaryBuilder().append(header).append(samp).append(desc);
    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(2);
    // Brush A should get the 2x2 image (uuid-A), not the 3x3 (uuid-B)
    expect(result[0].name).toBe("Brush A");
    expect(result[0].width).toBe(2);
    expect(result[0].height).toBe(2);
    expect(result[0].params!.diameter).toBeCloseTo(20);

    expect(result[1].name).toBe("Brush B");
    expect(result[1].width).toBe(3);
    expect(result[1].height).toBe(3);
    expect(result[1].params!.diameter).toBeCloseTo(30);
  });

  it("includes computed brush presets without image data", () => {
    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255], uuid: "uuid-sampled" },
    ], 2);

    const desc = buildDescSection([
      { name: "Hard Round", brushItems: [untfItem("Hrdn", "#Prc", 100)] },
      { name: "Textured", tipUuid: "uuid-sampled", brushItems: [untfItem("Dmtr", "#Pxl", 30)] },
      { name: "Soft Round", brushItems: [untfItem("Hrdn", "#Prc", 0)] },
    ]);

    const data = new BinaryBuilder().append(header).append(samp).append(desc);
    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(3);

    // Computed preset — no image data
    expect(result[0].name).toBe("Hard Round");
    expect(result[0].imageData).toBeUndefined();
    expect(result[0].params!.hardness).toBeCloseTo(1.0);

    // Sampled preset — has image data
    expect(result[1].name).toBe("Textured");
    expect(result[1].imageData).toBeDefined();
    expect(result[1].width).toBe(2);

    // Another computed preset
    expect(result[2].name).toBe("Soft Round");
    expect(result[2].imageData).toBeUndefined();
    expect(result[2].params!.hardness).toBeCloseTo(0.0);
  });

  it("allows multiple presets to share the same samp entry", () => {
    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 4, height: 4, pixels: new Array(16).fill(128), uuid: "shared-tip" },
    ], 2);

    const desc = buildDescSection([
      { name: "Variant 1", tipUuid: "shared-tip", brushItems: [untfItem("Dmtr", "#Pxl", 20)] },
      { name: "Variant 2", tipUuid: "shared-tip", brushItems: [untfItem("Dmtr", "#Pxl", 50)] },
    ]);

    const data = new BinaryBuilder().append(header).append(samp).append(desc);
    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(2);
    expect(result[0].name).toBe("Variant 1");
    expect(result[0].width).toBe(4);
    expect(result[0].params!.diameter).toBeCloseTo(20);
    expect(result[1].name).toBe("Variant 2");
    expect(result[1].width).toBe(4);
    expect(result[1].params!.diameter).toBeCloseTo(50);
  });

  it("extracts brush parameters from desc section", () => {
    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255], uuid: "tip-1" },
    ], 2);
    const desc = buildDescSection([{
      name: "Test Brush",
      tipUuid: "tip-1",
      brushItems: [
        untfItem("Dmtr", "#Pxl", 45.0),
        untfItem("Spcn", "#Prc", 30.0),
        untfItem("Angl", "#Ang", 15.0),
        untfItem("Rndn", "#Prc", 80.0),
        boolItem("flipX", true),
        boolItem("flipY", false),
      ],
    }]);

    const data = new BinaryBuilder()
      .append(header).append(samp).append(desc);

    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Test Brush");
    expect(result[0].params!.diameter).toBeCloseTo(45.0);
    expect(result[0].params!.spacing).toBeCloseTo(0.30);
    expect(result[0].params!.angle).toBeCloseTo(15.0);
    expect(result[0].params!.roundness).toBeCloseTo(0.80);
    expect(result[0].params!.flipX).toBe(true);
    expect(result[0].params!.flipY).toBe(false);
  });

  it("handles desc section with opacity and flow in toolOptions", () => {
    const toolOptsDesc = new BinaryBuilder()
      .unicodeString("").classId("PbTl")
      .u32(2)
      .append(longItem("Opct", 60))
      .append(longItem("flow", 40));

    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255], uuid: "tip-1" },
    ], 2);
    const desc = buildDescSection([{
      name: "Soft Brush",
      tipUuid: "tip-1",
      presetItems: [
        new BinaryBuilder().key("toolOptions").tag("Objc").append(toolOptsDesc),
      ],
    }]);

    const data = new BinaryBuilder()
      .append(header).append(samp).append(desc);

    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].params!.opacity).toBeCloseTo(0.60);
    expect(result[0].params!.flow).toBeCloseTo(0.40);
  });

  it("falls back to defaults when desc has no parameters", () => {
    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255], uuid: "tip-1" },
    ], 2);
    const desc = buildDescSection([{
      name: "Empty Brush",
      tipUuid: "tip-1",
    }]);

    const data = new BinaryBuilder()
      .append(header).append(samp).append(desc);

    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Empty Brush");
    expect(result[0].params).toBeDefined();
    expect(result[0].params!.diameter).toBeUndefined();
    expect(result[0].params!.spacing).toBeUndefined();
  });

  it("extracts shape dynamics from desc section", () => {
    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255], uuid: "tip-1" },
    ], 2);

    // Build shape dynamics items
    const szVr = new BinaryBuilder().key("szVr").tag("Objc").append(buildBrVr(2, 0, 10));
    const angleDyn = new BinaryBuilder().key("angleDynamics").tag("Objc").append(buildBrVr(0, 100));
    const rndDyn = new BinaryBuilder().key("roundnessDynamics").tag("Objc").append(buildBrVr(0, 0));

    const desc = buildDescSection([{
      name: "Dynamic Brush",
      tipUuid: "tip-1",
      presetItems: [
        boolItem("useTipDynamics", true),
        szVr,
        angleDyn,
        rndDyn,
      ],
    }]);

    const data = new BinaryBuilder()
      .append(header).append(samp).append(desc);

    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    const sd = result[0].params!.shapeDynamics!;
    expect(sd).toBeDefined();

    // Size: bVTy=2 (PenPressure) → control=1, jitter=0%, minimum=10%
    expect(sd.size.control).toBe(1);
    expect(sd.size.jitter).toBeCloseTo(0);
    expect(sd.size.minimum).toBeCloseTo(0.1);

    // Angle: bVTy=0, jitter=100% → control=0 (Off), jitter=1.0 (random via jitter alone)
    expect(sd.angle.control).toBe(0);
    expect(sd.angle.jitter).toBeCloseTo(1.0);

    // Roundness: bVTy=0, jitter=0% → control=0 (Off)
    expect(sd.roundness.control).toBe(0);
  });

  it("extracts transfer dynamics from desc section", () => {
    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255], uuid: "tip-1" },
    ], 2);

    const opVr = new BinaryBuilder().key("opVr").tag("Objc").append(buildBrVr(0, 20));
    const prVr = new BinaryBuilder().key("prVr").tag("Objc").append(buildBrVr(2, 0, 5));

    const desc = buildDescSection([{
      name: "Transfer Brush",
      tipUuid: "tip-1",
      presetItems: [
        boolItem("usePaintDynamics", true),
        opVr,
        prVr,
      ],
    }]);

    const data = new BinaryBuilder().append(header).append(samp).append(desc);
    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    const td = result[0].params!.transferDynamics!;
    expect(td).toBeDefined();

    // Opacity: bVTy=0, jitter=20% → control=0 (Off), jitter=0.2 (random via jitter alone)
    expect(td.opacity.control).toBe(0);
    expect(td.opacity.jitter).toBeCloseTo(0.2);

    // Flow: bVTy=2 (PenPressure) → control=1, minimum=5%
    expect(td.flow.control).toBe(1);
    expect(td.flow.jitter).toBeCloseTo(0);
    expect(td.flow.minimum).toBeCloseTo(0.05);
  });

  it("does not include dynamics when useTipDynamics is false", () => {
    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255], uuid: "tip-1" },
    ], 2);

    const desc = buildDescSection([{
      name: "Static Brush",
      tipUuid: "tip-1",
      presetItems: [
        boolItem("useTipDynamics", false),
        boolItem("usePaintDynamics", false),
      ],
    }]);

    const data = new BinaryBuilder().append(header).append(samp).append(desc);
    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].params!.shapeDynamics).toBeUndefined();
    expect(result[0].params!.transferDynamics).toBeUndefined();
  });

  it("extracts dual brush settings from desc section", () => {
    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255], uuid: "tip-1" },
    ], 2);

    // Build a nested dualBrush Objc descriptor — useDualBrush lives inside it
    const dualItems = [
      boolItem("useDualBrush", true),
      enumItem("Md  ", "BlnM", "Drkn"),
      untfItem("Dmtr", "#Pxl", 25),
      untfItem("Spcn", "#Prc", 50),
      untfItem("Hrdn", "#Prc", 80),
    ];
    const dualDesc = new BinaryBuilder()
      .unicodeString("")
      .classId("dualBrush")
      .u32(dualItems.length);
    for (const item of dualItems) dualDesc.append(item);

    const desc = buildDescSection([{
      name: "Dual Brush",
      tipUuid: "tip-1",
      presetItems: [
        new BinaryBuilder().key("dualBrush").tag("Objc").append(dualDesc),
      ],
    }]);

    const data = new BinaryBuilder().append(header).append(samp).append(desc);
    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    const db = result[0].params!.dualBrush!;
    expect(db).toBeDefined();
    expect(db.enabled).toBe(true);
    expect(db.mode).toBe(1); // Darken
    expect(db.size).toBe(25);
    expect(db.spacing).toBeCloseTo(0.5);
    expect(db.hardness).toBeCloseTo(0.8);
  });

  it("extracts smoothing from toolOptions", () => {
    const toolOptsDesc = new BinaryBuilder()
      .unicodeString("").classId("PbTl")
      .u32(1)
      .append(untfItem("Smoo", "#Prc", 75));

    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255], uuid: "tip-1" },
    ], 2);
    const desc = buildDescSection([{
      name: "Smooth Brush",
      tipUuid: "tip-1",
      presetItems: [
        new BinaryBuilder().key("toolOptions").tag("Objc").append(toolOptsDesc),
      ],
    }]);

    const data = new BinaryBuilder().append(header).append(samp).append(desc);
    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].params!.smoothing).toBeCloseTo(0.75);
  });

  it("does not include dual brush when useDualBrush is false", () => {
    const header = new BinaryBuilder().u16(6).u16(2);
    const samp = buildSampSection([
      { width: 2, height: 2, pixels: [255, 255, 255, 255], uuid: "tip-1" },
    ], 2);

    // useDualBrush: false inside the dualBrush sub-descriptor
    const dualItems = [boolItem("useDualBrush", false)];
    const dualDesc = new BinaryBuilder()
      .unicodeString("")
      .classId("dualBrush")
      .u32(dualItems.length);
    for (const item of dualItems) dualDesc.append(item);

    const desc = buildDescSection([{
      name: "No Dual",
      tipUuid: "tip-1",
      presetItems: [
        new BinaryBuilder().key("dualBrush").tag("Objc").append(dualDesc),
      ],
    }]);

    const data = new BinaryBuilder().append(header).append(samp).append(desc);
    const buf = new Uint8Array(data.toArray()).buffer;
    const result = parseAbrFile(buf);

    expect(result.length).toBe(1);
    expect(result[0].params!.dualBrush).toBeUndefined();
  });
});
