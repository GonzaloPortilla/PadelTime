import { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { ApiError } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<unknown>;
}

export function ConfirmDialog({ open, onClose, title, message, confirmLabel, tone = "danger", onConfirm }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={close}>Volver</Button>
          <Button
            variant={tone}
            loading={loading}
            onClick={async () => {
              setLoading(true);
              setError(null);
              try {
                await onConfirm();
                close();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Ocurrió un error inesperado");
              } finally {
                setLoading(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
    </Modal>
  );
}
