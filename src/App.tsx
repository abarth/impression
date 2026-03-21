import { useMemo } from "react";
import { type EngineInitOptions } from "./hooks/useEngine";
import { useDocumentManager } from "./hooks/useDocumentManager";
import { DocumentPicker } from "./components/DocumentPicker";
import { DocumentViewer } from "./components/DocumentViewer";

export function App() {
  const docManager = useDocumentManager();

  // Stabilize engine init options to avoid re-triggering on every render
  const engineOptions: EngineInitOptions | null = useMemo(() => {
    if (!docManager.currentDocument) return null;
    return {
      documentSize: {
        width: docManager.currentDocument.width,
        height: docManager.currentDocument.height,
      },
      opLogEntries: docManager.currentOpLogEntries,
      storage: docManager.storage,
      documentMeta: docManager.currentDocument,
    };
  }, [docManager.currentDocument, docManager.currentOpLogEntries, docManager.storage]);

  if (!docManager.ready) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-graphite-950">
        <span className="text-cream-muted text-[13px]">Loading...</span>
      </div>
    );
  }

  if (!docManager.currentDocument) {
    return (
      <DocumentPicker
        documents={docManager.documents}
        onOpen={docManager.openDocument}
        onDelete={docManager.deleteDocument}
        onRename={docManager.renameDocument}
        onCreate={(name, width, height, ppi) => {
          docManager.createDocument(name, width, height, ppi);
        }}
      />
    );
  }

  return (
    <DocumentViewer
      name={docManager.currentDocument.name ?? "painting"}
      engineOptions={engineOptions!}
      onClose={docManager.closeDocument}
      onNewDocument={(name, w, h, ppi) => {
        docManager.createDocument(name, w, h, ppi);
      }}
    />
  )
}
