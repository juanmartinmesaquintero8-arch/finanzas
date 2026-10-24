'use client';

import { useId } from 'react';
import ui from './ui.module.css';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  options: ChipOption<T>[];
  value: T | '';
  onChange: (value: T) => void;
}

/** Grupo de chips de selección única (accesible como radiogroup). */
export function ChipGroup<T extends string>({ label, options, value, onChange }: Props<T>) {
  const id = useId();
  return (
    <div className={ui.field}>
      <span className={ui.label} id={id}>
        {label}
      </span>
      <div className={ui.chips} role="radiogroup" aria-labelledby={id} aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={ui.chip}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
