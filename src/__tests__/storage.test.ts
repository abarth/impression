import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { Storage, type DocumentMeta } from "../storage";

function makeMeta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    id: "doc-1",
    name: "Test Document",
    width: 1920,
    height: 1080,
    ppi: 72,
    created_at: Date.now(),
    modified_at: Date.now(),
    ...overrides,
  };
}

let openStorage: Storage | null = null;

// Wrap Storage.open to track the instance for cleanup
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

describe("Storage: document operations", () => {
  it("creates and retrieves a document", async () => {
    const storage = await openTestStorage();
    const meta = makeMeta();
    await storage.createDocument(meta);

    const retrieved = await storage.getDocument("doc-1");
    expect(retrieved).toEqual(meta);
  });

  it("returns undefined for missing document", async () => {
    const storage = await openTestStorage();
    const result = await storage.getDocument("nonexistent");
    expect(result).toBeUndefined();
  });

  it("lists multiple documents", async () => {
    const storage = await openTestStorage();
    const doc1 = makeMeta({ id: "a", name: "First" });
    const doc2 = makeMeta({ id: "b", name: "Second" });
    const doc3 = makeMeta({ id: "c", name: "Third" });

    await storage.createDocument(doc1);
    await storage.createDocument(doc2);
    await storage.createDocument(doc3);

    const docs = await storage.listDocuments();
    expect(docs).toHaveLength(3);
    const ids = docs.map((d) => d.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("updates a document", async () => {
    const storage = await openTestStorage();
    const meta = makeMeta();
    await storage.createDocument(meta);

    const updated = { ...meta, name: "Updated Name", modified_at: Date.now() };
    await storage.updateDocument(updated);

    const retrieved = await storage.getDocument("doc-1");
    expect(retrieved?.name).toBe("Updated Name");
  });

  it("deletes a document", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());
    await storage.deleteDocument("doc-1");

    const result = await storage.getDocument("doc-1");
    expect(result).toBeUndefined();
  });
});

describe("Storage: operation log", () => {
  it("appends and retrieves entries in sequence order", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    const entry0 = new Uint8Array([1, 2, 3]);
    const entry1 = new Uint8Array([4, 5, 6]);
    const entry2 = new Uint8Array([7, 8, 9]);

    // Append out of order to verify sorting
    await storage.appendOpLogEntry("doc-1", 2, entry2);
    await storage.appendOpLogEntry("doc-1", 0, entry0);
    await storage.appendOpLogEntry("doc-1", 1, entry1);

    const entries = await storage.getOpLog("doc-1");
    expect(entries).toHaveLength(3);
    expect(Array.from(entries[0].data)).toEqual([1, 2, 3]);
    expect(Array.from(entries[1].data)).toEqual([4, 5, 6]);
    expect(Array.from(entries[2].data)).toEqual([7, 8, 9]);
    expect(entries[0].sequence).toBe(0);
    expect(entries[1].sequence).toBe(1);
    expect(entries[2].sequence).toBe(2);
  });

  it("counts entries for a document", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    await storage.appendOpLogEntry("doc-1", 0, new Uint8Array([1]));
    await storage.appendOpLogEntry("doc-1", 1, new Uint8Array([2]));

    const count = await storage.getOpLogCount("doc-1");
    expect(count).toBe(2);
  });

  it("returns empty array for document with no entries", async () => {
    const storage = await openTestStorage();
    const entries = await storage.getOpLog("nonexistent");
    expect(entries).toEqual([]);
  });

  it("deletes op_log when document is deleted", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());
    await storage.appendOpLogEntry("doc-1", 0, new Uint8Array([1, 2, 3]));
    await storage.appendOpLogEntry("doc-1", 1, new Uint8Array([4, 5, 6]));

    await storage.deleteDocument("doc-1");

    const entries = await storage.getOpLog("doc-1");
    expect(entries).toEqual([]);
  });

  it("round-trips binary data correctly", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;

    await storage.appendOpLogEntry("doc-1", 0, original);

    const entries = await storage.getOpLog("doc-1");
    expect(entries).toHaveLength(1);
    expect(Array.from(entries[0].data)).toEqual(Array.from(original));
  });

  it("keeps entries from different documents separate", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta({ id: "a" }));
    await storage.createDocument(makeMeta({ id: "b" }));

    await storage.appendOpLogEntry("a", 0, new Uint8Array([10]));
    await storage.appendOpLogEntry("b", 0, new Uint8Array([20]));
    await storage.appendOpLogEntry("a", 1, new Uint8Array([11]));

    const entriesA = await storage.getOpLog("a");
    const entriesB = await storage.getOpLog("b");

    expect(entriesA).toHaveLength(2);
    expect(entriesB).toHaveLength(1);
    expect(Array.from(entriesA[0].data)).toEqual([10]);
    expect(Array.from(entriesB[0].data)).toEqual([20]);
  });

  it("getOpLogAfter filters by sequence", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    await storage.appendOpLogEntry("doc-1", 0, new Uint8Array([10]));
    await storage.appendOpLogEntry("doc-1", 1, new Uint8Array([20]));
    await storage.appendOpLogEntry("doc-1", 2, new Uint8Array([30]));

    const after0 = await storage.getOpLogAfter("doc-1", 0);
    expect(after0).toHaveLength(2);
    expect(after0[0].sequence).toBe(1);
    expect(after0[1].sequence).toBe(2);

    const after1 = await storage.getOpLogAfter("doc-1", 1);
    expect(after1).toHaveLength(1);
    expect(after1[0].sequence).toBe(2);
  });

  it("getMaxSequence returns highest sequence or -1", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    expect(await storage.getMaxSequence("doc-1")).toBe(-1);

    await storage.appendOpLogEntry("doc-1", 0, new Uint8Array([1]));
    await storage.appendOpLogEntry("doc-1", 5, new Uint8Array([2]));

    expect(await storage.getMaxSequence("doc-1")).toBe(5);
  });
});

describe("Storage: document resources", () => {
  it("saves and retrieves a document resource", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    await storage.saveDocumentResource({
      document_id: "doc-1",
      resource_type: "brush-tip",
      resource_id: "tip-1",
      data: { id: "tip-1", pixels: [1, 2, 3], width: 2, height: 2 },
    });

    const resource = await storage.getDocumentResource("doc-1", "brush-tip", "tip-1");
    expect(resource).toBeDefined();
    expect(resource!.resource_id).toBe("tip-1");
    expect((resource!.data as { id: string }).id).toBe("tip-1");
  });

  it("lists all resources for a document", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    await storage.saveDocumentResource({
      document_id: "doc-1",
      resource_type: "brush-tip",
      resource_id: "tip-1",
      data: { id: "tip-1" },
    });
    await storage.saveDocumentResource({
      document_id: "doc-1",
      resource_type: "gradient",
      resource_id: "grad-1",
      data: { id: "grad-1" },
    });

    const resources = await storage.getDocumentResources("doc-1");
    expect(resources).toHaveLength(2);
    const types = resources.map(r => r.resource_type).sort();
    expect(types).toEqual(["brush-tip", "gradient"]);
  });

  it("deletes resources when document is deleted", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    await storage.saveDocumentResource({
      document_id: "doc-1",
      resource_type: "gradient",
      resource_id: "grad-1",
      data: { id: "grad-1" },
    });

    await storage.deleteDocument("doc-1");

    const resources = await storage.getDocumentResources("doc-1");
    expect(resources).toEqual([]);
  });

  it("keeps resources from different documents separate", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta({ id: "a" }));
    await storage.createDocument(makeMeta({ id: "b" }));

    await storage.saveDocumentResource({
      document_id: "a",
      resource_type: "brush-tip",
      resource_id: "tip-1",
      data: { id: "tip-1" },
    });
    await storage.saveDocumentResource({
      document_id: "b",
      resource_type: "brush-tip",
      resource_id: "tip-2",
      data: { id: "tip-2" },
    });

    const resA = await storage.getDocumentResources("a");
    const resB = await storage.getDocumentResources("b");
    expect(resA).toHaveLength(1);
    expect(resB).toHaveLength(1);
    expect(resA[0].resource_id).toBe("tip-1");
    expect(resB[0].resource_id).toBe("tip-2");
  });

  it("returns undefined for missing resource", async () => {
    const storage = await openTestStorage();
    const result = await storage.getDocumentResource("doc-1", "brush-tip", "nope");
    expect(result).toBeUndefined();
  });
});
