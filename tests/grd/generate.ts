/**
 * Generate synthetic .grd test files for integration testing.
 *
 * Run: npx tsx tests/grd/generate.ts
 *
 * These files exercise the two GRD layout variants that Photoshop produces.
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

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
  writeUnicodeString(s: string): void {
    this.writeU32(s.length + 1);
    for (let i = 0; i < s.length; i++) this.writeU16(s.charCodeAt(i));
    this.writeU16(0);
  }
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
  build(): Uint8Array {
    let totalLen = 0;
    for (const p of this.parts) totalLen += p.length;
    const out = new Uint8Array(totalLen);
    let off = 0;
    for (const p of this.parts) {
      if (p instanceof Uint8Array) {
        out.set(p, off);
      } else {
        for (let i = 0; i < p.length; i++) out[off + i] = p[i];
      }
      off += p.length;
    }
    return out;
  }
}

interface ColorStop {
  position: number;
  midpoint: number;
  r: number;
  g: number;
  b: number;
}
interface OpacityStop {
  position: number;
  midpoint: number;
  opacity: number;
}

function writeGradientBody(
  b: GrdBuilder,
  name: string,
  colorStops: ColorStop[],
  opacityStops: OpacityStop[],
): void {
  b.writeU32(5);
  b.writeTEXT("Nm  ", name);
  b.writeEnum("GrdF", "GrdF", "CstS");
  b.writeLong("Intr", 4096);

  b.writeKey("Clrs");
  b.writeTag("VlLs");
  b.writeU32(colorStops.length);
  for (const s of colorStops) {
    b.writeTag("Objc");
    b.writeUnicodeString("");
    b.writeClassId("Clrt");
    b.writeU32(4);
    b.writeKey("Clr ");
    b.writeTag("Objc");
    b.writeUnicodeString("");
    b.writeClassId("RGBC");
    b.writeU32(3);
    b.writeUntF("Rd  ", "#Rlt", s.r);
    b.writeUntF("Grn ", "#Rlt", s.g);
    b.writeUntF("Bl  ", "#Rlt", s.b);
    b.writeEnum("Type", "Clry", "UsrS");
    b.writeLong("Lctn", s.position);
    b.writeLong("Mdpn", s.midpoint);
  }

  b.writeKey("Trns");
  b.writeTag("VlLs");
  b.writeU32(opacityStops.length);
  for (const s of opacityStops) {
    b.writeTag("Objc");
    b.writeUnicodeString("");
    b.writeClassId("TrnS");
    b.writeU32(3);
    b.writeUntF("Opct", "#Prc", s.opacity);
    b.writeLong("Lctn", s.position);
    b.writeLong("Mdpn", s.midpoint);
  }
}

const outDir = resolve(dirname(new URL(import.meta.url).pathname));

// --- File 1: GrdL layout (flat), 2 gradients ---
{
  const b = new GrdBuilder();
  b.writeTag("8BGR");
  b.writeU16(5);
  b.writeU32(0);
  b.writeUnicodeString("");
  b.writeClassId("null");
  b.writeU32(1);
  b.writeKey("GrdL");
  b.writeTag("VlLs");
  b.writeU32(2);

  // Gradient 1: Red → Blue
  b.writeTag("Objc");
  b.writeUnicodeString("");
  b.writeClassId("Grdn");
  writeGradientBody(
    b,
    "Red to Blue",
    [
      { position: 0, midpoint: 50, r: 255, g: 0, b: 0 },
      { position: 4096, midpoint: 50, r: 0, g: 0, b: 255 },
    ],
    [
      { position: 0, midpoint: 50, opacity: 100 },
      { position: 4096, midpoint: 50, opacity: 100 },
    ],
  );

  // Gradient 2: White → Black
  b.writeTag("Objc");
  b.writeUnicodeString("");
  b.writeClassId("Grdn");
  writeGradientBody(
    b,
    "White to Black",
    [
      { position: 0, midpoint: 50, r: 255, g: 255, b: 255 },
      { position: 4096, midpoint: 50, r: 0, g: 0, b: 0 },
    ],
    [
      { position: 0, midpoint: 50, opacity: 100 },
      { position: 4096, midpoint: 50, opacity: 100 },
    ],
  );

  writeFileSync(resolve(outDir, "flat-layout.grd"), b.build());
  console.log("Generated flat-layout.grd");
}

// --- File 2: GrdL + Grad wrapper, 3 gradients ---
{
  const b = new GrdBuilder();
  b.writeTag("8BGR");
  b.writeU16(5);
  b.writeU32(0);
  b.writeUnicodeString("");
  b.writeClassId("null");
  b.writeU32(1);
  b.writeKey("GrdL");
  b.writeTag("VlLs");
  b.writeU32(3);

  const gradients = [
    {
      name: "Sunset",
      colors: [
        { position: 0, midpoint: 50, r: 255, g: 64, b: 0 },
        { position: 2048, midpoint: 50, r: 255, g: 200, b: 0 },
        { position: 4096, midpoint: 50, r: 128, g: 0, b: 128 },
      ],
    },
    {
      name: "Ocean",
      colors: [
        { position: 0, midpoint: 50, r: 0, g: 32, b: 64 },
        { position: 4096, midpoint: 50, r: 0, g: 192, b: 255 },
      ],
    },
    {
      name: "Forest",
      colors: [
        { position: 0, midpoint: 50, r: 0, g: 64, b: 0 },
        { position: 2048, midpoint: 50, r: 32, g: 128, b: 16 },
        { position: 4096, midpoint: 50, r: 128, g: 200, b: 64 },
      ],
    },
  ];

  for (const g of gradients) {
    b.writeTag("Objc");
    b.writeUnicodeString("");
    b.writeClassId("Grdn");
    b.writeU32(1);
    b.writeKey("Grad");
    b.writeTag("Objc");
    b.writeUnicodeString("");
    b.writeClassId("Grdn");
    writeGradientBody(
      b,
      g.name,
      g.colors,
      [
        { position: 0, midpoint: 50, opacity: 100 },
        { position: 4096, midpoint: 50, opacity: 100 },
      ],
    );
  }

  writeFileSync(resolve(outDir, "grad-wrapper.grd"), b.build());
  console.log("Generated grad-wrapper.grd");
}

console.log("Done.");
