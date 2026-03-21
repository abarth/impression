import type { BrushPreset, StoredBrushTip } from "./brushPresets";
import { DEFAULT_PRESETS } from "./brushPresets";
import type { Gradient } from "./gradient";
import { DEFAULT_GRADIENTS } from "./gradient";

const DB_NAME = "impression";
const DB_VERSION = 4;

export interface DocumentMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  ppi: number;
  created_at: number;
  modified_at: number;
}

/** A single entry in the append-only operation log. */
export interface OpLogEntry {
  document_id: string;
  sequence: number;
  data: Uint8Array;
}

/** A resource (brush tip or gradient) embedded in a document. */
export interface DocumentResource {
  document_id: string;
  resource_type: "brush-tip" | "gradient";
  resource_id: string;
  data: unknown;
}

export class Storage {
  private db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<Storage> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;

        if (!db.objectStoreNames.contains("documents")) {
          db.createObjectStore("documents", { keyPath: "id" });
        }

        // v3 → v4: Replace operation_chunks with op_log + document_resources
        if (oldVersion < 4) {
          if (db.objectStoreNames.contains("operation_chunks")) {
            db.deleteObjectStore("operation_chunks");
          }
        }

        if (!db.objectStoreNames.contains("op_log")) {
          const opLog = db.createObjectStore("op_log", {
            keyPath: ["document_id", "sequence"],
          });
          opLog.createIndex("by_document", "document_id", { unique: false });
        }

        if (!db.objectStoreNames.contains("document_resources")) {
          const resources = db.createObjectStore("document_resources", {
            keyPath: ["document_id", "resource_type", "resource_id"],
          });
          resources.createIndex("by_document", "document_id", { unique: false });
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
        if (!db.objectStoreNames.contains("gradient_presets")) {
          const gradients = db.createObjectStore("gradient_presets", { keyPath: "id" });
          gradients.createIndex("by_group", "group", { unique: false });
          for (const gradient of DEFAULT_GRADIENTS) {
            gradients.put(gradient);
          }
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
    await this.deleteOpLog(id);
    await this.deleteDocumentResources(id);
    return this.delete("documents", id);
  }

  // -- Operation Log --

  async appendOpLogEntry(
    documentId: string,
    sequence: number,
    data: Uint8Array,
  ): Promise<void> {
    const entry: OpLogEntry = {
      document_id: documentId,
      sequence,
      data,
    };
    return this.put("op_log", entry);
  }

  /** Get all op_log entries for a document, ordered by sequence. */
  async getOpLog(documentId: string): Promise<OpLogEntry[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("op_log", "readonly");
      const store = tx.objectStore("op_log");
      const index = store.index("by_document");
      const request = index.getAll(documentId);

      request.onsuccess = () => {
        const entries = (request.result as OpLogEntry[]).sort(
          (a, b) => a.sequence - b.sequence,
        );
        resolve(entries);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** Get op_log entries with sequence > afterSequence, ordered by sequence. */
  async getOpLogAfter(
    documentId: string,
    afterSequence: number,
  ): Promise<OpLogEntry[]> {
    const all = await this.getOpLog(documentId);
    return all.filter((e) => e.sequence > afterSequence);
  }

  /** Get the highest sequence number in the op_log for a document, or -1 if empty. */
  async getMaxSequence(documentId: string): Promise<number> {
    const entries = await this.getOpLog(documentId);
    if (entries.length === 0) return -1;
    return entries[entries.length - 1].sequence;
  }

  async getOpLogCount(documentId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("op_log", "readonly");
      const store = tx.objectStore("op_log");
      const index = store.index("by_document");
      const request = index.count(documentId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async deleteOpLog(documentId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("op_log", "readwrite");
      const store = tx.objectStore("op_log");
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

  // -- Document Resources --

  async saveDocumentResource(resource: DocumentResource): Promise<void> {
    return this.put("document_resources", resource);
  }

  /** Get all resources for a document. */
  async getDocumentResources(documentId: string): Promise<DocumentResource[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("document_resources", "readonly");
      const store = tx.objectStore("document_resources");
      const index = store.index("by_document");
      const request = index.getAll(documentId);

      request.onsuccess = () => resolve(request.result as DocumentResource[]);
      request.onerror = () => reject(request.error);
    });
  }

  /** Get a specific resource for a document. */
  async getDocumentResource(
    documentId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<DocumentResource | undefined> {
    return this.get("document_resources", [documentId, resourceType, resourceId]);
  }

  private async deleteDocumentResources(documentId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("document_resources", "readwrite");
      const store = tx.objectStore("document_resources");
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

  // -- Gradient Presets --

  async listGradients(): Promise<Gradient[]> {
    return this.getAll("gradient_presets");
  }

  async getGradient(id: string): Promise<Gradient | undefined> {
    return this.get("gradient_presets", id);
  }

  async saveGradient(gradient: Gradient): Promise<void> {
    return this.put("gradient_presets", gradient);
  }

  async deleteGradient(id: string): Promise<void> {
    return this.delete("gradient_presets", id);
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
