import type { ExtractedField } from '../types/ui';

interface Props {
  label: string;
  field: ExtractedField<string> | null;
  value: string;
  placeholder?: string;
  options?: readonly string[];
  onChange: (next: string) => void;
}

/**
 * A form field the agent filled in. Shows what it found and how sure it was,
 * and stays fully editable — the coordinator confirms, they do not just accept.
 */
export function ExtractedInput({ label, field, value, placeholder, options, onChange }: Props) {
  const found = field?.value != null && field.value !== '';
  const low = found && field!.confidence < 0.7;
  const edited = found && value !== field!.value;

  return (
    <label className="field-row extracted" data-low={low}>
      <span className="extracted-label">
        {label}
        {found ? (
          <span className="extracted-mark" data-low={low}>
            read from document · {field!.confidence.toFixed(2)}
          </span>
        ) : (
          field !== null && <span className="extracted-mark" data-missing="true">not found</span>
        )}
      </span>

      {options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}

      {found && field!.sourceHint && !edited && (
        <span className="extracted-source">{field!.sourceHint}</span>
      )}
      {edited && <span className="extracted-source" data-edited="true">Corrected by you</span>}
    </label>
  );
}
