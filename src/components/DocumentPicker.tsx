import { useState } from "react";
import { FileText, Trash2, Pencil, Check, X } from "lucide-react";
import type { DocumentMeta } from "../storage";
import { NewDocumentDialog } from "./NewDocumentDialog";

interface DocumentPickerProps {
  documents: DocumentMeta[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (name: string, width: number, height: number, ppi: number) => void;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function DocumentPicker({
  documents,
  onOpen,
  onDelete,
  onRename,
  onCreate,
}: DocumentPickerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startRename(doc: DocumentMeta) {
    setEditingId(doc.id);
    setEditName(doc.name);
  }

  function commitRename(id: string) {
    if (editName.trim()) {
      onRename(id, editName.trim());
    }
    setEditingId(null);
  }

  function cancelRename() {
    setEditingId(null);
  }

  return (
    <div className="flex items-center justify-center w-full h-full bg-graphite-950">
      <div className="flex flex-col items-center gap-6 max-w-lg w-full px-6">
        <h1 className="text-[18px] font-medium text-cream">Impression</h1>
        <p className="text-[13px] text-cream-muted -mt-3">
          {documents.length === 0
            ? "Create a new painting to get started."
            : "Open a painting or create a new one."}
        </p>

        <NewDocumentDialog onCreateDocument={onCreate} />

        {documents.length > 0 && (
          <div className="w-full flex flex-col gap-1.5 mt-2">
            <h2 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase mb-1">
              Recent Paintings
            </h2>
            {documents.map(doc => (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl
                  bg-graphite-900 border border-graphite-850
                  hover:border-graphite-750 hover:bg-graphite-850
                  transition-all duration-150 group"
              >
                <FileText size={18} strokeWidth={1.5} className="text-cream-muted shrink-0" />

                {editingId === doc.id ? (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitRename(doc.id);
                        if (e.key === "Escape") cancelRename();
                      }}
                      autoFocus
                      className="flex-1 bg-graphite-800 text-cream text-[13px] px-2 py-0.5
                        rounded-md border border-graphite-700 outline-none
                        focus:border-warm-accent min-w-0"
                    />
                    <button
                      onClick={() => commitRename(doc.id)}
                      className="p-1 rounded-md text-cream-muted hover:text-cream
                        hover:bg-graphite-750 transition-all duration-150 cursor-pointer"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={cancelRename}
                      className="p-1 rounded-md text-cream-muted hover:text-cream
                        hover:bg-graphite-750 transition-all duration-150 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => onOpen(doc.id)}
                  >
                    <div className="text-[13px] text-cream truncate">{doc.name}</div>
                    <div className="text-[11px] text-cream-muted">
                      {doc.width} × {doc.height} &middot; Modified {formatDate(doc.modified_at)}
                    </div>
                  </div>
                )}

                {editingId !== doc.id && (
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <button
                      onClick={e => { e.stopPropagation(); startRename(doc); }}
                      title="Rename"
                      className="p-1.5 rounded-lg text-cream-muted hover:text-cream
                        hover:bg-graphite-750 transition-all duration-150 cursor-pointer"
                    >
                      <Pencil size={13} strokeWidth={2} />
                    </button>
                    {confirmDeleteId === doc.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={e => { e.stopPropagation(); onDelete(doc.id); setConfirmDeleteId(null); }}
                          className="px-2 py-1 rounded-lg text-[11px] bg-red-900/50 text-red-300
                            hover:bg-red-900/80 transition-all duration-150 cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                          className="p-1.5 rounded-lg text-cream-muted hover:text-cream
                            hover:bg-graphite-750 transition-all duration-150 cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(doc.id); }}
                        title="Delete"
                        className="p-1.5 rounded-lg text-cream-muted hover:text-cream
                          hover:bg-graphite-750 transition-all duration-150 cursor-pointer"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
