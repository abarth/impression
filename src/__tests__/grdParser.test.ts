import { describe, it, expect } from "vitest";
import { parseGrdFile, convertParsedGradients } from "../grdParser";

/**
 * Build a synthetic GRD file buffer for testing.
 *
 * GRD format: "8BGR" magic + u16 version + top-level descriptor
 * containing a "GrSt" object with a "Grdn" list of gradient descriptors.
 */
class GrdBuilder {
  private parts: (Uint8Array | number[])[] = [];

  writeTag(tag: string): void {
    this.parts.push(Array.from(tag).map((c) => c.charCodeAt(0)));
  }

  writeU8(v: number): void {
    this.parts.push([v & 0xff]);
  }

  writeU16(v: number): void {
    this.parts.push([(v >> 8) & 0xff, v & 0xff]);
  }

  writeU32(v: number): void {
    this.parts.push([
      (v >> 24) & 0xff,
      (v >> 16) & 0xff,
      (v >> 8) & 0xff,
      v & 0xff,
    ]);
  }

  writeF64(v: number): void {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, v, false);
    this.parts.push(new Uint8Array(buf));
  }

  /** Write a Unicode string (u32 length + UTF-16BE chars + null). */
  writeUnicodeString(s: string): void {
    this.writeU32(s.length + 1); // +1 for null terminator
    for (let i = 0; i < s.length; i++) {
      this.writeU16(s.charCodeAt(i));
    }
    this.writeU16(0); // null terminator
  }

  /** Write a ClassID: u32 length (0 = 4-char key). */
  writeClassId(id: string): void {
    if (id.length === 4) {
      this.writeU32(0);
      this.writeTag(id);
    } else {
      this.writeU32(id.length);
      this.parts.push(Array.from(id).map((c) => c.charCodeAt(0)));
    }
  }

  writeKey(key: string): void {
    this.writeClassId(key);
  }

  /** Write a descriptor header: unicode name + classId + item count. */
  writeDescriptorHeader(
    name: string,
    classId: string,
    itemCount: number,
  ): void {
    this.writeUnicodeString(name);
    this.writeClassId(classId);
    this.writeU32(itemCount);
  }

  writeLong(key: string, value: number): void {
    this.writeKey(key);
    this.writeTag("long");
    this.writeU32(value);
  }

  writeUntF(key: string, unit: string, value: number): void {
    this.writeKey(key);
    this.writeTag("UntF");
    this.writeTag(unit);
    this.writeF64(value);
  }

  writeEnum(key: string, enumType: string, value: string): void {
    this.writeKey(key);
    this.writeTag("enum");
    this.writeClassId(enumType);
    this.writeClassId(value);
  }

  writeTEXT(key: string, value: string): void {
    this.writeKey(key);
    this.writeTag("TEXT");
    this.writeUnicodeString(value);
  }

  build(): ArrayBuffer {
    let totalLen = 0;
    for (const p of this.parts) totalLen += p.length;
    const out = new Uint8Array(totalLen);
    let off = 0;
    for (const p of this.parts) {
      if (p instanceof Uint8Array) {
        out.set(p, off);
      } else {
        for (let i = 0; i < p.length; i++) {
          out[off + i] = p[i];
        }
      }
      off += p.length;
    }
    return out.buffer;
  }
}

/**
 * Write the body of a gradient descriptor (Nm, GrdF, Intr, Clrs, Trns).
 */
function writeGradientBody(
  b: GrdBuilder,
  opts: {
    name?: string;
    smoothness?: number;
    colorStops?: Array<{
      position: number;
      midpoint: number;
      r: number;
      g: number;
      b: number;
    }>;
    opacityStops?: Array<{
      position: number;
      midpoint: number;
      opacity: number;
    }>;
  },
): void {
  b.writeU32(5); // Nm, GrdF, Intr, Clrs, Trns

  b.writeTEXT("Nm  ", opts.name ?? "Test Gradient");
  b.writeEnum("GrdF", "GrdF", "CstS");

  const smoothnessVal = Math.round(
    ((opts.smoothness ?? 100) / 100) * 4096,
  );
  b.writeLong("Intr", smoothnessVal);

  const colorStops = opts.colorStops ?? [
    { position: 0, midpoint: 50, r: 0, g: 0, b: 0 },
    { position: 4096, midpoint: 50, r: 255, g: 255, b: 255 },
  ];

  b.writeKey("Clrs");
  b.writeTag("VlLs");
  b.writeU32(colorStops.length);

  for (const stop of colorStops) {
    b.writeTag("Objc");
    b.writeUnicodeString("");
    b.writeClassId("Clrt");
    b.writeU32(4);

    b.writeKey("Clr ");
    b.writeTag("Objc");
    b.writeUnicodeString("");
    b.writeClassId("RGBC");
    b.writeU32(3);
    b.writeUntF("Rd  ", "#Rlt", stop.r);
    b.writeUntF("Grn ", "#Rlt", stop.g);
    b.writeUntF("Bl  ", "#Rlt", stop.b);

    b.writeEnum("Type", "Clry", "UsrS");
    b.writeLong("Lctn", stop.position);
    b.writeLong("Mdpn", stop.midpoint);
  }

  const opacityStops = opts.opacityStops ?? [
    { position: 0, midpoint: 50, opacity: 100 },
    { position: 4096, midpoint: 50, opacity: 100 },
  ];

  b.writeKey("Trns");
  b.writeTag("VlLs");
  b.writeU32(opacityStops.length);

  for (const stop of opacityStops) {
    b.writeTag("Objc");
    b.writeUnicodeString("");
    b.writeClassId("TrnS");
    b.writeU32(3);

    b.writeUntF("Opct", "#Prc", stop.opacity);
    b.writeLong("Lctn", stop.position);
    b.writeLong("Mdpn", stop.midpoint);
  }
}

type GradientOpts = Parameters<typeof writeGradientBody>[1];

/**
 * Build a GRD file using the GrdL layout (flat gradient list).
 */
function buildGrdWithGrdL(opts: GradientOpts): ArrayBuffer {
  const b = new GrdBuilder();

  b.writeTag("8BGR");
  b.writeU16(5);
  b.writeU32(0);

  b.writeUnicodeString("");
  b.writeClassId("null");
  b.writeU32(1);

  b.writeKey("GrdL");
  b.writeTag("VlLs");
  b.writeU32(1);

  b.writeTag("Objc");
  b.writeUnicodeString("");
  b.writeClassId("Grdn");
  writeGradientBody(b, opts);

  return b.build();
}

/**
 * Build a GRD file using the "Grad" wrapper layout.
 * Each gradient Objc contains a single "Grad" key wrapping the real data.
 * This matches the structure produced by some versions of Photoshop.
 */
function buildGrdWithGradWrapper(opts: GradientOpts): ArrayBuffer {
  const b = new GrdBuilder();

  b.writeTag("8BGR");
  b.writeU16(5);
  b.writeU32(0);

  b.writeUnicodeString("");
  b.writeClassId("null");
  b.writeU32(1);

  b.writeKey("GrdL");
  b.writeTag("VlLs");
  b.writeU32(1);

  // Outer Objc with a single "Grad" key
  b.writeTag("Objc");
  b.writeUnicodeString("");
  b.writeClassId("Grdn");
  b.writeU32(1); // 1 item: "Grad"

  b.writeKey("Grad");
  b.writeTag("Objc");
  b.writeUnicodeString("");
  b.writeClassId("Grdn");
  writeGradientBody(b, opts);

  return b.build();
}

/**
 * Build a GRD file with multiple gradients using "Grad" wrapper layout.
 */
function buildGrdMultipleGradients(
  gradients: GradientOpts[],
): ArrayBuffer {
  const b = new GrdBuilder();

  b.writeTag("8BGR");
  b.writeU16(5);
  b.writeU32(0);

  b.writeUnicodeString("");
  b.writeClassId("null");
  b.writeU32(1);

  b.writeKey("GrdL");
  b.writeTag("VlLs");
  b.writeU32(gradients.length);

  for (const opts of gradients) {
    b.writeTag("Objc");
    b.writeUnicodeString("");
    b.writeClassId("Grdn");
    b.writeU32(1);

    b.writeKey("Grad");
    b.writeTag("Objc");
    b.writeUnicodeString("");
    b.writeClassId("Grdn");
    writeGradientBody(b, opts);
  }

  return b.build();
}

describe("parseGrdFile", () => {
  it("parses a minimal solid gradient", () => {
    const buffer = buildGrdWithGrdL({});
    const gradients = parseGrdFile(buffer);

    expect(gradients).toHaveLength(1);
    expect(gradients[0].name).toBe("Test Gradient");
    expect(gradients[0].form).toBe("solid");
    expect(gradients[0].colorStops).toHaveLength(2);
    expect(gradients[0].opacityStops).toHaveLength(2);
  });

  it("parses color stops with RGB values", () => {
    const buffer = buildGrdWithGrdL({
      colorStops: [
        { position: 0, midpoint: 50, r: 255, g: 0, b: 0 },
        { position: 2048, midpoint: 75, r: 0, g: 255, b: 0 },
        { position: 4096, midpoint: 50, r: 0, g: 0, b: 255 },
      ],
    });
    const gradients = parseGrdFile(buffer);

    expect(gradients[0].colorStops).toHaveLength(3);
    expect(gradients[0].colorStops[0].color).toBe("#ff0000");
    expect(gradients[0].colorStops[0].position).toBeCloseTo(0, 2);
    expect(gradients[0].colorStops[1].color).toBe("#00ff00");
    expect(gradients[0].colorStops[1].position).toBeCloseTo(0.5, 2);
    expect(gradients[0].colorStops[1].midpoint).toBeCloseTo(0.75, 2);
    expect(gradients[0].colorStops[2].color).toBe("#0000ff");
    expect(gradients[0].colorStops[2].position).toBeCloseTo(1, 2);
  });

  it("parses opacity stops", () => {
    const buffer = buildGrdWithGrdL({
      opacityStops: [
        { position: 0, midpoint: 50, opacity: 100 },
        { position: 2048, midpoint: 50, opacity: 50 },
        { position: 4096, midpoint: 50, opacity: 0 },
      ],
    });
    const gradients = parseGrdFile(buffer);

    expect(gradients[0].opacityStops).toHaveLength(3);
    expect(gradients[0].opacityStops[0].opacity).toBeCloseTo(1, 2);
    expect(gradients[0].opacityStops[1].opacity).toBeCloseTo(0.5, 2);
    expect(gradients[0].opacityStops[2].opacity).toBeCloseTo(0, 2);
  });

  it("parses smoothness", () => {
    const buffer = buildGrdWithGrdL({ smoothness: 50 });
    const gradients = parseGrdFile(buffer);

    expect(gradients[0].smoothness).toBeCloseTo(50, 0);
  });

  it("parses gradient name", () => {
    const buffer = buildGrdWithGrdL({ name: "My Cool Gradient" });
    const gradients = parseGrdFile(buffer);

    expect(gradients[0].name).toBe("My Cool Gradient");
  });

  it("returns empty array for empty buffer", () => {
    const buffer = new ArrayBuffer(0);
    expect(parseGrdFile(buffer)).toEqual([]);
  });

  it("returns empty array for invalid data", () => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setUint32(0, 0xdeadbeef);
    expect(parseGrdFile(buffer)).toEqual([]);
  });

  it("parses gradients with Grad wrapper (Photoshop export format)", () => {
    const buffer = buildGrdWithGradWrapper({
      name: "Wrapped Gradient",
      colorStops: [
        { position: 0, midpoint: 50, r: 255, g: 128, b: 0 },
        { position: 4096, midpoint: 50, r: 0, g: 64, b: 255 },
      ],
    });
    const gradients = parseGrdFile(buffer);

    expect(gradients).toHaveLength(1);
    expect(gradients[0].name).toBe("Wrapped Gradient");
    expect(gradients[0].colorStops).toHaveLength(2);
    expect(gradients[0].colorStops[0].color).toBe("#ff8000");
    expect(gradients[0].colorStops[1].color).toBe("#0040ff");
  });

  it("parses multiple gradients with Grad wrapper", () => {
    const buffer = buildGrdMultipleGradients([
      { name: "Sunrise" },
      { name: "Sunset" },
      { name: "Ocean" },
    ]);
    const gradients = parseGrdFile(buffer);

    expect(gradients).toHaveLength(3);
    expect(gradients[0].name).toBe("Sunrise");
    expect(gradients[1].name).toBe("Sunset");
    expect(gradients[2].name).toBe("Ocean");
  });
});

describe("convertParsedGradients", () => {
  it("converts parsed gradients with IDs and group", () => {
    const parsed = parseGrdFile(buildGrdWithGrdL({}));
    const gradients = convertParsedGradients(parsed, "Imported - test.grd", 5);

    expect(gradients).toHaveLength(1);
    expect(gradients[0].id).toBeTruthy();
    expect(gradients[0].group).toBe("Imported - test.grd");
    expect(gradients[0].sort_order).toBe(5);
    expect(gradients[0].name).toBe("Test Gradient");
    expect(gradients[0].colorStops).toHaveLength(2);
  });

  it("filters out noise gradients", () => {
    // noise gradients have no color stops, so they're filtered
    const parsed = [
      {
        name: "Noise",
        colorStops: [],
        opacityStops: [],
        smoothness: 100,
        form: "noise" as const,
      },
    ];
    const gradients = convertParsedGradients(parsed, "test");
    expect(gradients).toHaveLength(0);
  });
});

describe("parseGrdFile (binary test files)", () => {
  it("parses flat-layout.grd (GrdL, no Grad wrapper)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../tests/grd/flat-layout.grd");
    const buf = fs.readFileSync(filePath);
    const gradients = parseGrdFile(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );

    expect(gradients).toHaveLength(2);
    expect(gradients[0].name).toBe("Red to Blue");
    expect(gradients[0].colorStops[0].color).toBe("#ff0000");
    expect(gradients[0].colorStops[1].color).toBe("#0000ff");
    expect(gradients[1].name).toBe("White to Black");
  });

  it("parses grad-wrapper.grd (GrdL with Grad wrapper)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../tests/grd/grad-wrapper.grd");
    const buf = fs.readFileSync(filePath);
    const gradients = parseGrdFile(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );

    expect(gradients).toHaveLength(3);
    expect(gradients[0].name).toBe("Sunset");
    expect(gradients[0].colorStops).toHaveLength(3);
    expect(gradients[1].name).toBe("Ocean");
    expect(gradients[1].colorStops).toHaveLength(2);
    expect(gradients[2].name).toBe("Forest");
    expect(gradients[2].colorStops).toHaveLength(3);
  });
});
