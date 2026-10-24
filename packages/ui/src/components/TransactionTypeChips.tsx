'use client';

import type { TransactionType } from '../lib/types';
import { ChipGroup } from './ChipGroup';

export const TRANSACTION_TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: 'INCOME', label: 'Ingreso' },
  { value: 'EXPENSE', label: 'Gasto' },
  { value: 'TRANSFER', label: 'Transferencia' },
];

interface Props {
  value: TransactionType;
  onChange: (value: TransactionType) => void;
}

export function TransactionTypeChips({ value, onChange }: Props) {
  return <ChipGroup label="Tipo" options={TRANSACTION_TYPE_OPTIONS} value={value} onChange={onChange} />;
}
