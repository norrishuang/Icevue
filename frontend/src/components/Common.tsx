import type { ReactNode } from "react";
import { AlertTriangle, Inbox, LoaderCircle, RefreshCw } from "lucide-react";

export function LoadingState({ label = "Loading metadata" }: { label?: string }) {
  return (
    <div className="center-state">
      <LoaderCircle className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="center-state center-state--error">
      <AlertTriangle size={25} />
      <strong>{title}</strong>
      <span>{message}</span>
      {onRetry && (
        <button className="button" onClick={onRetry}>
          <RefreshCw size={15} />
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  icon,
}: {
  title: string;
  detail: string;
  icon?: ReactNode;
}) {
  return (
    <div className="center-state">
      {icon ?? <Inbox size={25} />}
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function CopyValue({ value, label }: { value: string; label: string }) {
  async function copy() {
    await navigator.clipboard.writeText(value);
  }

  return (
    <button className="copy-value" onClick={copy} title={`Copy ${label}`}>
      <span>{value}</span>
      <span className="copy-value__hint">Copy</span>
    </button>
  );
}

