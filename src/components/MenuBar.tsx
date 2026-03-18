import * as Menubar from "@radix-ui/react-menubar";

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
}

const itemClass =
  `flex items-center justify-between px-2.5 py-[5px] text-[12.5px] text-cream-dim
   outline-none rounded-md cursor-default select-none
   data-[highlighted]:bg-graphite-750 data-[highlighted]:text-cream
   data-[disabled]:opacity-30 data-[disabled]:pointer-events-none`;

const shortcutClass = "ml-auto pl-5 text-[11px] text-cream-muted tabular-nums tracking-wide";

const separatorClass = "h-px my-1 bg-graphite-800";

const contentClass =
  `min-w-[180px] bg-graphite-900 border border-graphite-800
   rounded-lg p-1 shadow-panel z-50`;

function MenuTrigger({ label }: { label: string }) {
  return (
    <Menubar.Trigger
      className="px-2 py-0.5 text-[12px] text-cream-muted rounded-md outline-none
        cursor-default select-none transition-colors duration-100
        hover:text-cream-dim
        data-[state=open]:bg-graphite-800 data-[state=open]:text-cream-dim"
    >
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
}: MenuBarProps) {
  return (
    <Menubar.Root className="flex items-center h-7 px-1.5 bg-graphite-950 border-b border-graphite-850 shrink-0">
      <Menubar.Menu>
        <MenuTrigger label="File" />
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={2}>
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
    </Menubar.Root>
  );
}
