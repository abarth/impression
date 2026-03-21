import * as AlertDialog from "@radix-ui/react-alert-dialog";

interface ImportErrorDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
}

export function ImportErrorDialog({
  open,
  onClose,
  title,
  message,
}: ImportErrorDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[360px] rounded-xl bg-graphite-900 border border-graphite-750 p-5
            shadow-panel flex flex-col gap-4"
        >
          <AlertDialog.Title className="text-[14px] font-medium text-cream">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[12px] text-cream-dim leading-relaxed">
            {message}
          </AlertDialog.Description>
          <div className="flex justify-end">
            <AlertDialog.Action asChild>
              <button
                className="px-4 py-1.5 rounded-lg text-[12px] font-medium
                  bg-graphite-800 text-cream hover:bg-graphite-700
                  transition-all duration-150 cursor-pointer"
              >
                OK
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
