/**
 * Comprehensive persistence integration tests.
 *
 * These tests demonstrate the correct design patterns for the new
 * sequence-based op_log persistence layer with document-scoped resources.
 *
 * Pattern 1: Append-only op_log with monotonic sequence numbers
 * Pattern 2: Document resources are embedded once and deduplicated
 * Pattern 3: Op log entries survive document reload (full round-trip)
 * Pattern 4: Document deletion cascades to op_log and resources
 * Pattern 5: Multiple documents are fully isolated
 */
import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { Storage, type DocumentMeta } from "../storage";

let openStorage: Storage | null = null;

async function openTestStorage(): Promise<Storage> {
  const s = await Storage.open();
  openStorage = s;
  return s;
}

afterEach(async () => {
  if (openStorage) {
    openStorage.close();
    openStorage = null;
  }
  indexedDB.deleteDatabase("impression");
});

function makeMeta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    id: "doc-1",
    name: "Test Painting",
    width: 1920,
    height: 1080,
    ppi: 72,
    created_at: Date.now(),
    modified_at: Date.now(),
    ...overrides,
  };
}

describe("Persistence: op_log round-trip patterns", () => {
  it("Pattern 1: append-only log preserves all entries for timelapse", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    // Simulate a painting session: 10 stroke batches
    for (let seq = 0; seq < 10; seq++) {
      const data = new Uint8Array([0xff, 0x01, seq, seq + 1]);
      await storage.appendOpLogEntry("doc-1", seq, data);
    }

    const entries = await storage.getOpLog("doc-1");
    expect(entries).toHaveLength(10);

    // All entries preserved in order (timelapse can replay them)
    for (let i = 0; i < 10; i++) {
      expect(entries[i].sequence).toBe(i);
      expect(entries[i].data[2]).toBe(i);
    }
  });

  it("Pattern 2: sequence continues from last value after reload", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    // Session 1: write entries 0-4
    for (let seq = 0; seq < 5; seq++) {
      await storage.appendOpLogEntry("doc-1", seq, new Uint8Array([seq]));
    }

    const maxSeq = await storage.getMaxSequence("doc-1");
    expect(maxSeq).toBe(4);

    // Session 2: continue from maxSeq + 1
    const nextSequence = maxSeq + 1;
    await storage.appendOpLogEntry("doc-1", nextSequence, new Uint8Array([99]));

    const entries = await storage.getOpLog("doc-1");
    expect(entries).toHaveLength(6);
    expect(entries[5].sequence).toBe(5);
    expect(entries[5].data[0]).toBe(99);
  });

  it("Pattern 3: getOpLogAfter enables incremental loading", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    for (let seq = 0; seq < 10; seq++) {
      await storage.appendOpLogEntry("doc-1", seq, new Uint8Array([seq]));
    }

    // Load only entries after sequence 6 (e.g., after snapshot)
    const recent = await storage.getOpLogAfter("doc-1", 6);
    expect(recent).toHaveLength(3);
    expect(recent[0].sequence).toBe(7);
    expect(recent[1].sequence).toBe(8);
    expect(recent[2].sequence).toBe(9);
  });
});

describe("Persistence: document resource patterns", () => {
  it("Pattern 4: embed resource once, subsequent calls are idempotent", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    const gradientData = {
      id: "sunset-gradient",
      name: "Sunset",
      colorStops: [
        { position: 0, color: "#ff6600", midpoint: 0.5 },
        { position: 1, color: "#990066", midpoint: 0.5 },
      ],
    };

    // First embed
    await storage.saveDocumentResource({
      document_id: "doc-1",
      resource_type: "gradient",
      resource_id: "sunset-gradient",
      data: gradientData,
    });

    // Second embed (idempotent — should overwrite, not duplicate)
    await storage.saveDocumentResource({
      document_id: "doc-1",
      resource_type: "gradient",
      resource_id: "sunset-gradient",
      data: { ...gradientData, name: "Sunset Updated" },
    });

    const resources = await storage.getDocumentResources("doc-1");
    const gradients = resources.filter((r) => r.resource_type === "gradient");
    expect(gradients).toHaveLength(1);
    expect((gradients[0].data as { name: string }).name).toBe("Sunset Updated");
  });

  it("Pattern 5: brush tip data embedded for self-contained documents", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    // Embed brush tip pixel data
    const tipPixels = new Uint8Array(64 * 64); // 64x64 grayscale
    for (let i = 0; i < tipPixels.length; i++) tipPixels[i] = Math.floor(Math.random() * 256);

    await storage.saveDocumentResource({
      document_id: "doc-1",
      resource_type: "brush-tip",
      resource_id: "splatter-tip",
      data: { id: "splatter-tip", pixels: Array.from(tipPixels), width: 64, height: 64 },
    });

    // Retrieve and verify
    const resource = await storage.getDocumentResource("doc-1", "brush-tip", "splatter-tip");
    expect(resource).toBeDefined();
    const tipData = resource!.data as { id: string; pixels: number[]; width: number; height: number };
    expect(tipData.id).toBe("splatter-tip");
    expect(tipData.width).toBe(64);
    expect(tipData.height).toBe(64);
    expect(tipData.pixels.length).toBe(64 * 64);
  });

  it("Pattern 6: resources survive across storage reopen", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    await storage.saveDocumentResource({
      document_id: "doc-1",
      resource_type: "gradient",
      resource_id: "grad-1",
      data: { id: "grad-1", name: "Test Gradient" },
    });

    await storage.appendOpLogEntry("doc-1", 0, new Uint8Array([0xff, 0x01, 1, 2]));

    // Close and reopen
    storage.close();
    openStorage = null;
    const storage2 = await openTestStorage();

    const resources = await storage2.getDocumentResources("doc-1");
    expect(resources).toHaveLength(1);
    expect(resources[0].resource_id).toBe("grad-1");

    const entries = await storage2.getOpLog("doc-1");
    expect(entries).toHaveLength(1);
  });
});

describe("Persistence: document isolation patterns", () => {
  it("Pattern 7: deleting one document doesn't affect another", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta({ id: "painting-a" }));
    await storage.createDocument(makeMeta({ id: "painting-b" }));

    // Both documents get operations and resources
    await storage.appendOpLogEntry("painting-a", 0, new Uint8Array([10]));
    await storage.appendOpLogEntry("painting-b", 0, new Uint8Array([20]));
    await storage.saveDocumentResource({
      document_id: "painting-a",
      resource_type: "brush-tip",
      resource_id: "tip-1",
      data: { id: "tip-1" },
    });
    await storage.saveDocumentResource({
      document_id: "painting-b",
      resource_type: "brush-tip",
      resource_id: "tip-2",
      data: { id: "tip-2" },
    });

    // Delete painting-a
    await storage.deleteDocument("painting-a");

    // painting-b is unaffected
    const entriesB = await storage.getOpLog("painting-b");
    expect(entriesB).toHaveLength(1);
    const resourcesB = await storage.getDocumentResources("painting-b");
    expect(resourcesB).toHaveLength(1);

    // painting-a is gone
    const entriesA = await storage.getOpLog("painting-a");
    expect(entriesA).toHaveLength(0);
    const resourcesA = await storage.getDocumentResources("painting-a");
    expect(resourcesA).toHaveLength(0);
  });

  it("Pattern 8: sequence numbers are per-document", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta({ id: "doc-a" }));
    await storage.createDocument(makeMeta({ id: "doc-b" }));

    // Both start at sequence 0 independently
    await storage.appendOpLogEntry("doc-a", 0, new Uint8Array([1]));
    await storage.appendOpLogEntry("doc-a", 1, new Uint8Array([2]));
    await storage.appendOpLogEntry("doc-b", 0, new Uint8Array([3]));

    expect(await storage.getMaxSequence("doc-a")).toBe(1);
    expect(await storage.getMaxSequence("doc-b")).toBe(0);
    expect(await storage.getOpLogCount("doc-a")).toBe(2);
    expect(await storage.getOpLogCount("doc-b")).toBe(1);
  });
});

describe("Persistence: large document patterns", () => {
  it("Pattern 9: handles many entries efficiently", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    // Simulate a long painting session: 500 stroke batches
    const batchSize = 50;
    for (let batch = 0; batch < 500 / batchSize; batch++) {
      for (let i = 0; i < batchSize; i++) {
        const seq = batch * batchSize + i;
        const data = new Uint8Array(32); // ~32 bytes per entry (realistic for small ops)
        data[0] = 0xff;
        data[1] = 0x01;
        await storage.appendOpLogEntry("doc-1", seq, data);
      }
    }

    expect(await storage.getOpLogCount("doc-1")).toBe(500);

    // Load all entries (simulating document open)
    const all = await storage.getOpLog("doc-1");
    expect(all).toHaveLength(500);

    // Incremental load (simulating snapshot + replay of recent ops)
    const recent = await storage.getOpLogAfter("doc-1", 490);
    expect(recent).toHaveLength(9); // 491..499
  });

  it("Pattern 10: mixed resource types on same document", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    // Embed multiple brush tips and gradients
    for (let i = 0; i < 5; i++) {
      await storage.saveDocumentResource({
        document_id: "doc-1",
        resource_type: "brush-tip",
        resource_id: `tip-${i}`,
        data: { id: `tip-${i}`, width: 32, height: 32 },
      });
    }
    for (let i = 0; i < 3; i++) {
      await storage.saveDocumentResource({
        document_id: "doc-1",
        resource_type: "gradient",
        resource_id: `grad-${i}`,
        data: { id: `grad-${i}`, name: `Gradient ${i}` },
      });
    }

    const resources = await storage.getDocumentResources("doc-1");
    expect(resources).toHaveLength(8);

    const tips = resources.filter((r) => r.resource_type === "brush-tip");
    const grads = resources.filter((r) => r.resource_type === "gradient");
    expect(tips).toHaveLength(5);
    expect(grads).toHaveLength(3);

    // Individual lookup works
    const tip2 = await storage.getDocumentResource("doc-1", "brush-tip", "tip-2");
    expect(tip2).toBeDefined();
    expect((tip2!.data as { id: string }).id).toBe("tip-2");
  });
});
