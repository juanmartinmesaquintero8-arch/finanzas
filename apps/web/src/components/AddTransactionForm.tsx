'use client';

import { useState, type FormEvent } from 'react';
import { formatGroupedDigits } from '@/lib/format';
import type { ActionResult } from '@/lib/action-result';
import type { Account, CreateTransactionInput, TransactionType } from '@/lib/types';
import { validateTransactionForm, type FieldErrors } from '@/lib/validation';
import { ChipGroup } from './ChipGroup';
import { TransactionTypeChips } from './TransactionTypeChips';
import styles from './Form.module.css';
import ui from './ui.module.css';

interface Props {
  accounts: Account[];
  today: string;
  onSubmit: (input: CreateTransactionInput) => Promise<ActionResult>;
  onDone?: () => void;
}

const CATEGORIES: Record<TransactionType, string[]> = {
  EXPENSE: ['Comida', 'Transporte', 'Servicios', 'Mercado', 'Salud', 'Ocio', 'Hogar', 'Otros'],
  INCOME: ['Salario', 'Ventas', 'Regalo', 'Otros'],
  TRANSFER: [],
};

export function AddTransactionForm({ accounts, today, onSubmit, onDone }: Props) {
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [accountId, setAccountId] = useState('');
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const result = validateTransactionForm({ type, amountText, date, description, category, accountId, fromAccountId, toAccountId });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const response = await onSubmit(result.value);
      if (response.ok) onDone?.();
      else setServerError(response.error);
    } catch {
      setServerError('No pudimos guardar el movimiento. Intenta de nuevo.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={`${ui.card} ${styles.form}`} onSubmit={handleSubmit} noValidate>
      <TransactionTypeChips value={type} onChange={setType} />

      <div className={ui.field}>
        <label className={ui.label} htmlFor="amount">
          Monto
        </label>
        <div className={styles.money}>
          <span aria-hidden="true">$</span>
          <input
            id="amount"
            className={`${ui.input} ${styles.amountInput}`}
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            value={amountText}
            aria-invalid={errors.amount ? 'true' : undefined}
            aria-describedby={errors.amount ? 'amount-error' : undefined}
            onChange={(e) => setAmountText(formatGroupedDigits(e.target.value))}
          />
        </div>
        {errors.amount && (
          <p id="amount-error" className={ui.error}>
            {errors.amount}
          </p>
        )}
      </div>

      {type === 'TRANSFER' ? (
        <>
          <ChipGroup label="Desde" options={accountOptions} value={fromAccountId} onChange={setFromAccountId} />
          <ChipGroup label="Hacia" options={accountOptions} value={toAccountId} onChange={setToAccountId} />
        </>
      ) : (
        <ChipGroup label="Cuenta" options={accountOptions} value={accountId} onChange={setAccountId} />
      )}
      {errors.account && <p className={ui.error}>{errors.account}</p>}

      <div className={ui.field}>
        <label className={ui.label} htmlFor="description">
          Descripción
        </label>
        <input
          id="description"
          className={ui.input}
          maxLength={160}
          autoComplete="off"
          placeholder={type === 'INCOME' ? 'Ej: Pago de nómina' : 'Ej: Almuerzo'}
          value={description}
          aria-invalid={errors.description ? 'true' : undefined}
          aria-describedby={errors.description ? 'description-error' : undefined}
          onChange={(e) => setDescription(e.target.value)}
        />
        {errors.description && (
          <p id="description-error" className={ui.error}>
            {errors.description}
          </p>
        )}
      </div>

      {type !== 'TRANSFER' && (
        <div className={ui.field}>
          <label className={ui.label} htmlFor="category">
            Categoría (opcional)
          </label>
          <input
            id="category"
            className={ui.input}
            maxLength={60}
            autoComplete="off"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <div className={ui.chips} role="radiogroup" aria-label="Categorías sugeridas">
            {CATEGORIES[type].map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={category === c}
                className={ui.chip}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={ui.field}>
        <label className={ui.label} htmlFor="date">
          Fecha
        </label>
        <input
          id="date"
          type="date"
          className={ui.input}
          value={date}
          aria-invalid={errors.date ? 'true' : undefined}
          onChange={(e) => setDate(e.target.value)}
        />
        {errors.date && <p className={ui.error}>{errors.date}</p>}
      </div>

      {serverError && (
        <p role="alert" className={ui.alert}>
          {serverError}
        </p>
      )}

      <button type="submit" className={ui.button} disabled={pending}>
        {pending ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  );
}
