import type { BrushPreset, StoredBrushTip } from "./brushPresets";
import { DEFAULT_PRESETS } from "./brushPresets";

const DB_NAME = "impression";
const DB_VERSION = 2;

export interface DocumentMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  ppi: number;
  created_at: number;
  modified_at: number;
}

interface OperationChunk {
  document_id: string;
  chunk_index: number;
  data: Uint8Array;
}

export class Storage {
  private db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<Storage> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("documents")) {
          db.createObjectStore("documents", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("operation_chunks")) {
          const chunks = db.createObjectStore("operation_chunks", {
            keyPath: ["document_id", "chunk_index"],
          });
          chunks.createIndex("by_document", "document_id", { unique: false });
        }
        if (!db.objectStoreNames.contains("brush_presets")) {
          const presets = db.createObjectStore("brush_presets", { keyPath: "id" });
          presets.createIndex("by_group", "group", { unique: false });
          // Seed default presets
          for (const preset of DEFAULT_PRESETS) {
            presets.put(preset);
          }
        }
        if (!db.objectStoreNames.contains("brush_tips")) {
          db.createObjectStore("brush_tips", { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(new Storage(request.result));
      request.onerror = () => reject(request.error);
    });
  }

  async createDocument(meta: DocumentMeta): Promise<void> {
    return this.put("documents", meta);
  }

  async getDocument(id: string): Promise<DocumentMeta | undefined> {
    return this.get("documents", id);
  }

  async listDocuments(): Promise<DocumentMeta[]> {
    return this.getAll("documents");
  }

  async updateDocument(meta: DocumentMeta): Promise<void> {
    return this.put("documents", meta);
  }

  async deleteDocument(id: string): Promise<void> {
    await this.deleteChunks(id);
    return this.delete("documents", id);
  }

  async appendChunk(
    documentId: string,
    chunkIndex: number,
    data: Uint8Array,
  ): Promise<void> {
    const chunk: OperationChunk = {
      document_id: documentId,
      chunk_index: chunkIndex,
      data,
    };
    return this.put("operation_chunks", chunk);
  }

  async getChunks(documentId: string): Promise<Uint8Array[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("operation_chunks", "readonly");
      const store = tx.objectStore("operation_chunks");
      const index = store.index("by_document");
      const request = index.getAll(documentId);

      request.onsuccess = () => {
        const chunks = (request.result as OperationChunk[]).sort(
          (a, b) => a.chunk_index - b.chunk_index,
        );
        resolve(chunks.map((c) => c.data));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getChunkCount(documentId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("operation_chunks", "readonly");
      const store = tx.objectStore("operation_chunks");
      const index = store.index("by_document");
      const request = index.count(documentId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteChunks(documentId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("operation_chunks", "readwrite");
      const store = tx.objectStore("operation_chunks");
      const index = store.index("by_document");
      const request = index.openCursor(documentId);

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private put(storeName: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  private getAll<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  // -- Brush Presets --

  async listPresets(): Promise<BrushPreset[]> {
    return this.getAll("brush_presets");
  }

  async getPreset(id: string): Promise<BrushPreset | undefined> {
    return this.get("brush_presets", id);
  }

  async savePreset(preset: BrushPreset): Promise<void> {
    return this.put("brush_presets", preset);
  }

  async deletePreset(id: string): Promise<void> {
    return this.delete("brush_presets", id);
  }

  // -- Brush Tips --

  async listTips(): Promise<StoredBrushTip[]> {
    return this.getAll("brush_tips");
  }

  async getTip(id: string): Promise<StoredBrushTip | undefined> {
    return this.get("brush_tips", id);
  }

  async saveTip(tip: StoredBrushTip): Promise<void> {
    return this.put("brush_tips", tip);
  }

  async deleteTip(id: string): Promise<void> {
    return this.delete("brush_tips", id);
  }

  close(): void {
    this.db.close();
  }

  private delete(storeName: string, key: IDBValidKey): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
