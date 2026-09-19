import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string | null;
  label: string;
  /** null clears the field — an empty dose is a real value, not a blank. */
  onCommit: (next: string | null) => void;
  disabled?: boolean;
}

/**
 * Click a proposed value to correct it. Enter or blur commits, Escape reverts.
 * Nothing here writes to the log — promotion is still the only committing act.
 */
export function InlineEdit({ value, label, onCommit, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    const normalised = next === '' ? null : next;
    if (normalised !== value) onCommit(normalised);
  }

  if (disabled) return <span>{value ?? <span className="cell-empty">Not recorded</span>}</span>;

  if (editing) {
    return (
      <input
        ref={input}
        className="edit-input"
        value={draft}
        aria-label={`${label}, editing`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(value ?? '');
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      className="edit-trigger"
      data-empty={value === null}
      aria-label={`${label}: ${value ?? 'not recorded'}. Edit.`}
      onClick={() => setEditing(true)}
    >
      {value ?? 'Not recorded'}
    </button>
  );
}
