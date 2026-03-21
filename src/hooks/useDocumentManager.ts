import { useState, useEffect, useCallback, useRef } from "react";
import { Storage, type DocumentMeta } from "../storage";

export interface DocumentManagerState {
  /** All documents in storage, sorted by modified_at descending. */
  documents: DocumentMeta[];
  /** Whether the initial load from IndexedDB is complete. */
  ready: boolean;
  /** The currently open document, or null if none is open. */
  currentDocument: DocumentMeta | null;
  /** Operation log entries for the current document (loaded on open, empty for new docs). */
  currentOpLogEntries: Uint8Array[];
  /** Storage instance (null until initialized). */
  storage: Storage | null;
}

export interface DocumentManagerActions {
  createDocument: (name: string, width: number, height: number, ppi: number) => Promise<DocumentMeta>;
  openDocument: (id: string) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  renameDocument: (id: string, name: string) => Promise<void>;
  closeDocument: () => void;
}

/** Parse the hash route. Returns the document ID if on a doc route, null for picker. */
function parseRoute(): string | null {
  const hash = window.location.hash;
  const match = hash.match(/^#\/painting\/([a-f0-9-]+)$/i);
  return match ? match[1] : null;
}

/** Push a new hash route onto the history stack. */
function pushRoute(path: string): void {
  window.history.pushState(null, "", path);
}

/** Replace the current hash route without adding a history entry. */
function replaceRoute(path: string): void {
  window.history.replaceState(null, "", path);
}

export function useDocumentManager(): DocumentManagerState & DocumentManagerActions {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [ready, setReady] = useState(false);
  const [currentDocument, setCurrentDocument] = useState<DocumentMeta | null>(null);
  const [currentOpLogEntries, setCurrentOpLogEntries] = useState<Uint8Array[]>([]);
  const [storage, setStorage] = useState<Storage | null>(null);

  // Refs for popstate handler to avoid stale closures
  const storageRef = useRef<Storage | null>(null);
  const documentsRef = useRef<DocumentMeta[]>([]);

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

      // Check if URL points to a specific document
      const routeDocId = parseRoute();
      if (routeDocId) {
        const doc = docs.find(d => d.id === routeDocId);
        if (doc) {
          const entries = await s.getOpLog(routeDocId);
          if (cancelled) return;
          setCurrentOpLogEntries(entries.map(e => e.data));
          setCurrentDocument(doc);
        }
      }

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
    setCurrentOpLogEntries([]);
    setCurrentDocument(meta);
    pushRoute(`#/painting/${meta.id}`);
    return meta;
  }, [storage]);

  const openDocument = useCallback(async (id: string) => {
    if (!storage) return;
    const doc = documents.find(d => d.id === id);
    if (!doc) return;
    const entries = await storage.getOpLog(id);
    setCurrentOpLogEntries(entries.map(e => e.data));
    setCurrentDocument(doc);
    pushRoute(`#/painting/${id}`);
  }, [storage, documents]);

  const deleteDocument = useCallback(async (id: string) => {
    if (!storage) return;
    await storage.deleteDocument(id);
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (currentDocument?.id === id) {
      setCurrentDocument(null);
      setCurrentOpLogEntries([]);
      replaceRoute("#/");
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

  // Keep refs in sync for popstate handler
  storageRef.current = storage;
  documentsRef.current = documents;

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = async () => {
      const docId = parseRoute();
      if (docId) {
        const s = storageRef.current;
        const doc = documentsRef.current.find(d => d.id === docId);
        if (s && doc) {
          const entries = await s.getOpLog(docId);
          setCurrentOpLogEntries(entries.map(e => e.data));
          setCurrentDocument(doc);
        }
      } else {
        setCurrentDocument(null);
        setCurrentOpLogEntries([]);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const closeDocument = useCallback(() => {
    setCurrentDocument(null);
    setCurrentOpLogEntries([]);
    pushRoute("#/");
  }, []);

  return {
    documents,
    ready,
    currentDocument,
    currentOpLogEntries,
    storage,
    createDocument,
    openDocument,
    deleteDocument,
    renameDocument,
    closeDocument,
  };
}
