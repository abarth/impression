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

describe("Storage: operation chunks", () => {
  it("appends and retrieves chunks in order", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    const chunk0 = new Uint8Array([1, 2, 3]);
    const chunk1 = new Uint8Array([4, 5, 6]);
    const chunk2 = new Uint8Array([7, 8, 9]);

    // Append out of order to verify sorting
    await storage.appendChunk("doc-1", 2, chunk2);
    await storage.appendChunk("doc-1", 0, chunk0);
    await storage.appendChunk("doc-1", 1, chunk1);

    const chunks = await storage.getChunks("doc-1");
    expect(chunks).toHaveLength(3);
    expect(Array.from(chunks[0])).toEqual([1, 2, 3]);
    expect(Array.from(chunks[1])).toEqual([4, 5, 6]);
    expect(Array.from(chunks[2])).toEqual([7, 8, 9]);
  });

  it("counts chunks for a document", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    await storage.appendChunk("doc-1", 0, new Uint8Array([1]));
    await storage.appendChunk("doc-1", 1, new Uint8Array([2]));

    const count = await storage.getChunkCount("doc-1");
    expect(count).toBe(2);
  });

  it("returns empty array for document with no chunks", async () => {
    const storage = await openTestStorage();
    const chunks = await storage.getChunks("nonexistent");
    expect(chunks).toEqual([]);
  });

  it("deletes chunks when document is deleted", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());
    await storage.appendChunk("doc-1", 0, new Uint8Array([1, 2, 3]));
    await storage.appendChunk("doc-1", 1, new Uint8Array([4, 5, 6]));

    await storage.deleteDocument("doc-1");

    const chunks = await storage.getChunks("doc-1");
    expect(chunks).toEqual([]);
  });

  it("round-trips binary data correctly", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta());

    // Create a larger buffer with varied byte values
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;

    await storage.appendChunk("doc-1", 0, original);

    const chunks = await storage.getChunks("doc-1");
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0])).toEqual(Array.from(original));
  });

  it("keeps chunks from different documents separate", async () => {
    const storage = await openTestStorage();
    await storage.createDocument(makeMeta({ id: "a" }));
    await storage.createDocument(makeMeta({ id: "b" }));

    await storage.appendChunk("a", 0, new Uint8Array([10]));
    await storage.appendChunk("b", 0, new Uint8Array([20]));
    await storage.appendChunk("a", 1, new Uint8Array([11]));

    const chunksA = await storage.getChunks("a");
    const chunksB = await storage.getChunks("b");

    expect(chunksA).toHaveLength(2);
    expect(chunksB).toHaveLength(1);
    expect(Array.from(chunksA[0])).toEqual([10]);
    expect(Array.from(chunksB[0])).toEqual([20]);
  });
});
