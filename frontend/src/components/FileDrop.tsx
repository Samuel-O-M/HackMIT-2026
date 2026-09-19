import { useRef, useState, type ReactNode } from 'react';

interface Props {
  title: string;
  lede: ReactNode;
  accept: string;
  busy: boolean;
  busyLabel: string;
  chooseLabel: string;
  hint: string;
  error?: string | null;
  onFile: (file: File) => void;
}

/** Drop target plus a file picker. Keyboard users get the button, not the drop zone. */
export function FileDrop({
  title,
  lede,
  accept,
  busy,
  busyLabel,
  chooseLabel,
  hint,
  error,
  onFile,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  function take(files: FileList | null) {
    const file = files?.[0];
    if (file) onFile(file);
  }

  return (
    <section
      className="drop"
      data-dragging={dragging}
      data-busy={busy}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) take(e.dataTransfer.files);
      }}
    >
      <h2>{title}</h2>
      <p>{lede}</p>
      <input
        ref={picker}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
      <button className="btn btn-primary" disabled={busy} onClick={() => picker.current?.click()}>
        {busy ? busyLabel : chooseLabel}
      </button>
      <p className="drop-hint">{hint}</p>
      {error && (
        <p className="drop-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
