import { useCallback, useEffect, useRef, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'warn';
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, tone: Toast['tone'] = 'ok') => {
      const id = ++seq.current;
      setToasts((list) => [...list, { id, text, tone }]);
      timers.current.push(window.setTimeout(() => dismiss(id), 6000));
    },
    [dismiss],
  );

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-tone={toast.tone} role="status">
          <span>{toast.text}</span>
          <button className="toast-dismiss" onClick={() => onDismiss(toast.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
