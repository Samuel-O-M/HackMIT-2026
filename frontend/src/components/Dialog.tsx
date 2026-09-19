import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  /** One line under the title saying why this step exists. */
  lede?: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}

/**
 * Modal for the steps that must not be skippable: stating a reason for a
 * change, raising a query, filing a deviation, signing off a promotion.
 */
export function Dialog({
  title,
  lede,
  confirmLabel,
  confirmDisabled,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(
      'input, textarea, select, button:not([data-cancel])',
    );
    first?.focus();
    // A field that opens pre-filled holds a suggested draft, not a committed
    // value. Selecting it means typing replaces the whole thing, while clicking
    // into it puts the caret where you clicked and keeps the draft to edit.
    if (
      (first instanceof HTMLTextAreaElement || first instanceof HTMLInputElement) &&
      first.value !== ''
    ) {
      first.select();
    }
    return () => restoreTo.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
      // Keep focus inside the dialog while it is open.
      if (event.key === 'Tab' && panel.current) {
        const focusable = [
          ...panel.current.querySelectorAll<HTMLElement>(
            'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => !el.hasAttribute('disabled'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={panel}
      >
        <header className="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          {lede && <p>{lede}</p>}
        </header>

        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (!confirmDisabled) onConfirm();
          }}
        >
          {children}
          <div className="dialog-actions">
            <button className="btn" type="button" data-cancel onClick={onCancel}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={confirmDisabled}>
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
