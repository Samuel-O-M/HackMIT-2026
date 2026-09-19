import { useId, useState, type ReactNode } from 'react';

interface Props {
  /** What opens it. Short — it sits inline under whatever it explains. */
  label?: string;
  children: ReactNode;
  tone?: 'default' | 'alarm';
}

/**
 * Detail that is worth keeping but not worth showing. Same interaction as the
 * reasoning toggle on a change row, so "there is more here" reads the same way
 * everywhere in the app.
 */
export function Disclosure({ label = 'See details', children, tone = 'default' }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="detail" data-tone={tone}>
      <button
        className="disclose-btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <i aria-hidden="true" data-open={open} />
        {open ? 'Hide details' : label}
      </button>
      {open && (
        <div className="detail-body" id={id}>
          {children}
        </div>
      )}
    </div>
  );
}
