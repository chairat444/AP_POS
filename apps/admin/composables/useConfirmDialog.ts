export type ConfirmDialogOptions = {
  title?: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = ปุ่มแดง (ค่าเริ่มต้น) */
  tone?: "danger" | "primary";
};

type ConfirmDialogState = {
  open: boolean;
  busy: boolean;
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "danger" | "primary";
};

const state = reactive<ConfirmDialogState>({
  open: false,
  busy: false,
  title: "ยืนยันการลบ",
  message: "",
  detail: "",
  confirmLabel: "ลบ",
  cancelLabel: "ยกเลิก",
  tone: "danger",
});

let resolver: ((value: boolean) => void) | null = null;

function close(result: boolean) {
  if (!state.open) return;
  state.open = false;
  state.busy = false;
  const resolve = resolver;
  resolver = null;
  resolve?.(result);
}

/** Modal ยืนยันกลาง — ใช้กับปุ่มลบทุกหน้า */
export function useConfirmDialog() {
  function askConfirm(opts: ConfirmDialogOptions): Promise<boolean> {
    if (resolver) {
      resolver(false);
      resolver = null;
    }
    state.title = opts.title ?? "ยืนยันการลบ";
    state.message = opts.message;
    state.detail = opts.detail ?? "";
    state.confirmLabel = opts.confirmLabel ?? "ลบ";
    state.cancelLabel = opts.cancelLabel ?? "ยกเลิก";
    state.tone = opts.tone ?? "danger";
    state.busy = false;
    state.open = true;
    return new Promise<boolean>((resolve) => {
      resolver = resolve;
    });
  }

  function cancel() {
    close(false);
  }

  function confirm() {
    close(true);
  }

  return {
    state,
    askConfirm,
    cancel,
    confirm,
  };
}
