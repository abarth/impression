import { describe, it, expect } from "vitest";
import { parseAbrFile } from "../abrParser";

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
});
