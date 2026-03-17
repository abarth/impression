import { useState, useEffect, useCallback } from "react";
import { Storage, type DocumentMeta } from "../storage";

export interface DocumentManagerState {
  /** All documents in storage, sorted by modified_at descending. */
  documents: DocumentMeta[];
  /** Whether the initial load from IndexedDB is complete. */
  ready: boolean;
  /** The currently open document, or null if none is open. */
  currentDocument: DocumentMeta | null;
  /** Storage instance (null until initialized). */
  storage: Storage | null;
}

export interface DocumentManagerActions {
  createDocument: (name: string, width: number, height: number, ppi: number) => Promise<DocumentMeta>;
  openDocument: (id: string) => void;
  deleteDocument: (id: string) => Promise<void>;
  renameDocument: (id: string, name: string) => Promise<void>;
  closeDocument: () => void;
}

export function useDocumentManager(): DocumentManagerState & DocumentManagerActions {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [ready, setReady] = useState(false);
  const [currentDocument, setCurrentDocument] = useState<DocumentMeta | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);

  // Initialize storage and load documents
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await Storage.open();
      if (cancelled) { s.close(); return; }
      setStorage(s);

      const docs = await s.listDocuments();
      if (cancelled) return;
      docs.sort((a, b) => b.modified_at - a.modified_at);
      setDocuments(docs);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const createDocument = useCallback(async (
    name: string, width: number, height: number, ppi: number,
  ): Promise<DocumentMeta> => {
    if (!storage) throw new Error("Storage not ready");
    const now = Date.now();
    const meta: DocumentMeta = {
      id: crypto.randomUUID(),
      name,
      width,
      height,
      ppi,
      created_at: now,
      modified_at: now,
    };
    await storage.createDocument(meta);
    setDocuments(prev => [meta, ...prev]);
    setCurrentDocument(meta);
    return meta;
  }, [storage]);

  const openDocument = useCallback((id: string) => {
    const doc = documents.find(d => d.id === id);
    if (doc) setCurrentDocument(doc);
  }, [documents]);

  const deleteDocument = useCallback(async (id: string) => {
    if (!storage) return;
    await storage.deleteDocument(id);
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (currentDocument?.id === id) {
      setCurrentDocument(null);
    }
  }, [storage, currentDocument]);

  const renameDocument = useCallback(async (id: string, name: string) => {
    if (!storage) return;
    const doc = documents.find(d => d.id === id);
    if (!doc) return;
    const updated = { ...doc, name, modified_at: Date.now() };
    await storage.updateDocument(updated);
    setDocuments(prev => prev.map(d => d.id === id ? updated : d));
    if (currentDocument?.id === id) {
      setCurrentDocument(updated);
    }
  }, [storage, documents, currentDocument]);

  const closeDocument = useCallback(() => {
    setCurrentDocument(null);
  }, []);

  return {
    documents,
    ready,
    currentDocument,
    storage,
    createDocument,
    openDocument,
    deleteDocument,
    renameDocument,
    closeDocument,
  };
}
