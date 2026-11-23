import { RefreshCw, X } from 'lucide-react';

interface ErrorMessageProps {
  title?: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  onDismiss?: () => void;
  type?: 'error' | 'warning' | 'info';
}

export default function ErrorMessage({ title = 'Something went wrong', message, action, onDismiss, type = 'error' }: ErrorMessageProps) {
  return (
    <div className={`notice notice-${type} flex items-start gap-3`} role={type === 'error' ? 'alert' : 'status'}>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-0.5">{message}</p>
        {action && (
          <button type="button" onClick={action.onClick} className="btn-secondary mt-3 min-h-9 px-3 py-1.5">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {action.label}
          </button>
        )}
      </div>
      {onDismiss && (
        <button type="button" aria-label="Dismiss message" onClick={onDismiss} className="-m-1 p-1 opacity-70 hover:opacity-100">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
