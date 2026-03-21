import { useState, useEffect } from "react";
import * as Menubar from "@radix-ui/react-menubar";
import { NewDocumentDialog } from "./NewDocumentDialog";

interface MenuBarProps {
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onExport?: () => void;
  onClose?: () => void;
  onSelectAll?: () => void;
  onDeselect?: () => void;
  onClear?: () => void;
  onNewLayer?: () => void;
  onDeleteLayer?: () => void;
  canDeleteLayer?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitToScreen?: () => void;
  onSwapColors?: () => void;
  onDefaultColors?: () => void;
  onNewDocument?: (name: string, width: number, height: number, ppi: number) => void;
  onOpenDocument?: () => void;
}

const itemClass =
  "flex items-center justify-between px-2.5 py-[5px] text-[12.5px] text-cream-dim outline-none rounded-md cursor-default select-none data-[highlighted]:bg-graphite-750 data-[highlighted]:text-cream data-[disabled]:opacity-30 data-[disabled]:pointer-events-none";

const shortcutClass = "ml-auto pl-5 text-[11px] text-cream-muted tabular-nums tracking-wide";

const separatorClass = "h-px my-1 bg-graphite-800";

const contentClass =
  "min-w-[180px] bg-graphite-900 border border-graphite-800 rounded-lg p-1 shadow-panel z-50";

function MenuTrigger({ label }: { label: string }) {
  return (
    <Menubar.Trigger className="px-3 py-1 text-[12px] text-cream-muted rounded-md outline-none cursor-default select-none transition-colors duration-100 hover:text-cream-dim data-[state=open]:bg-graphite-800 data-[state=open]:text-cream-dim">
      {label}
    </Menubar.Trigger>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const modLabel = isMac ? "\u2318" : "Ctrl+";
const shiftLabel = isMac ? "\u21E7" : "Shift+";
const deleteLabel = isMac ? "\u232B" : "Del";

export function MenuBar({
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onExport,
  onClose,
  onSelectAll,
  onDeselect,
  onClear,
  onNewLayer,
  onDeleteLayer,
  canDeleteLayer = false,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onSwapColors,
  onDefaultColors,
  onNewDocument,
  onOpenDocument,
}: MenuBarProps) {
  const [newDocOpen, setNewDocOpen] = useState(false);

  // ⌘N / Ctrl+N keyboard shortcut to open New Document dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNewDocOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
    <NewDocumentDialog
      open={newDocOpen}
      onOpenChange={setNewDocOpen}
      showTrigger={false}
      onCreateDocument={(name, w, h, ppi) => {
        onNewDocument?.(name, w, h, ppi);
      }}
    />
    <Menubar.Root className="flex items-center h-8 px-1 gap-0.5 bg-graphite-950 border-b border-graphite-850 shrink-0">
      {/* File */}
      <Menubar.Menu>
        <MenuTrigger label="File" />
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={2}>
            <Menubar.Item className={itemClass} onSelect={() => setNewDocOpen(true)}>
              New...
              <span className={shortcutClass}>{modLabel}N</span>
            </Menubar.Item>
            <Menubar.Item className={itemClass} onSelect={onOpenDocument}>
              Open...
            </Menubar.Item>
            <Menubar.Separator className={separatorClass} />
            <Menubar.Item className={itemClass} onSelect={onExport}>
              Export as PNG
              <span className={shortcutClass}>{modLabel}{shiftLabel}E</span>
            </Menubar.Item>
            <Menubar.Separator className={separatorClass} />
            <Menubar.Item className={itemClass} onSelect={onClose}>
              Close
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* Edit */}
      <Menubar.Menu>
        <MenuTrigger label="Edit" />
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={2}>
            <Menubar.Item className={itemClass} disabled={!canUndo} onSelect={onUndo}>
              Undo
              <span className={shortcutClass}>{modLabel}Z</span>
            </Menubar.Item>
            <Menubar.Item className={itemClass} disabled={!canRedo} onSelect={onRedo}>
              Redo
              <span className={shortcutClass}>{modLabel}{shiftLabel}Z</span>
            </Menubar.Item>
            <Menubar.Separator className={separatorClass} />
            <Menubar.Item className={itemClass} onSelect={onClear}>
              Clear
              <span className={shortcutClass}>{deleteLabel}</span>
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* Layer */}
      <Menubar.Menu>
        <MenuTrigger label="Layer" />
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={2}>
            <Menubar.Item className={itemClass} onSelect={onNewLayer}>
              New Layer
              <span className={shortcutClass}>{modLabel}{shiftLabel}N</span>
            </Menubar.Item>
            <Menubar.Item className={itemClass} disabled={!canDeleteLayer} onSelect={onDeleteLayer}>
              Delete Layer
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* Select */}
      <Menubar.Menu>
        <MenuTrigger label="Select" />
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={2}>
            <Menubar.Item className={itemClass} onSelect={onSelectAll}>
              All
              <span className={shortcutClass}>{modLabel}A</span>
            </Menubar.Item>
            <Menubar.Item className={itemClass} onSelect={onDeselect}>
              Deselect
              <span className={shortcutClass}>{modLabel}D</span>
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* View */}
      <Menubar.Menu>
        <MenuTrigger label="View" />
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={2}>
            <Menubar.Item className={itemClass} onSelect={onZoomIn}>
              Zoom In
              <span className={shortcutClass}>{modLabel}=</span>
            </Menubar.Item>
            <Menubar.Item className={itemClass} onSelect={onZoomOut}>
              Zoom Out
              <span className={shortcutClass}>{modLabel}-</span>
            </Menubar.Item>
            <Menubar.Item className={itemClass} onSelect={onFitToScreen}>
              Fit on Screen
              <span className={shortcutClass}>{modLabel}0</span>
            </Menubar.Item>
            <Menubar.Separator className={separatorClass} />
            <Menubar.Item className={itemClass} onSelect={onSwapColors}>
              Swap Colors
              <span className={shortcutClass}>X</span>
            </Menubar.Item>
            <Menubar.Item className={itemClass} onSelect={onDefaultColors}>
              Default Colors
              <span className={shortcutClass}>D</span>
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>
    </Menubar.Root>
    </>
  );
}
