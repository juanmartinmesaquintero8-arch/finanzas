'use client';

import { useState, type FormEvent } from 'react';
import type { ActionResult } from '../lib/action-result';
import { formatGroupedDigits } from '../lib/format';
import type { Account, CreateScheduledExpenseInput, Frequency, ScheduledExpense } from '../lib/types';
import { validateScheduledForm, type FieldErrors } from '../lib/validation';
import { ChipGroup } from './ChipGroup';
import styles from './Form.module.css';
import ui from './ui.module.css';

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'MONTHLY', label: 'Cada mes' },
  { value: 'BIWEEKLY', label: 'Cada 2 semanas' },
  { value: 'WEEKLY', label: 'Cada semana' },
  { value: 'ONCE', label: 'Una vez' },
];

interface Props {
  accounts: Account[];
  today: string;
  onSubmit: (input: CreateScheduledExpenseInput) => Promise<ActionResult>;
  onDone?: () => void;
  /** Si se pasa, el formulario edita este gasto (precargado) en vez de crear uno nuevo. */
  expense?: ScheduledExpense;
  onCancel?: () => void;
}

export function ScheduledForm({ accounts, today, onSubmit, onDone, expense, onCancel }: Props) {
  const editing = !!expense;
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amountText, setAmountText] = useState(expense ? formatGroupedDigits(expense.amount.amount) : '');
  const [accountId, setAccountId] = useState(expense?.accountId ?? '');
  const [frequency, setFrequency] = useState<Frequency>(expense?.frequency ?? 'MONTHLY');
  const [startDate, setStartDate] = useState(expense?.startDate ?? today);
  const [endDate, setEndDate] = useState(expense?.endDate ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const result = validateScheduledForm({
      description,
      amountText,
      accountId,
      frequency,
      startDate,
      endDate: frequency === 'ONCE' ? '' : endDate,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const res = await onSubmit(result.value);
      if (res.ok) {
        if (!editing) {
          setDescription('');
          setAmountText('');
        }
        onDone?.();
      } else setServerError(res.error);
    } catch {
      setServerError('No pudimos guardar el gasto programado. Intenta de nuevo.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={`${ui.card} ${styles.form}`} onSubmit={handleSubmit} noValidate>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="sc-description">
          Descripción
        </label>
        <input
          id="sc-description"
          className={ui.input}
          maxLength={160}
          autoComplete="off"
          placeholder="Ej: Arriendo"
          value={description}
          aria-invalid={errors.description ? 'true' : undefined}
          onChange={(e) => setDescription(e.target.value)}
        />
        {errors.description && <p className={ui.error}>{errors.description}</p>}
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="sc-amount">
          Monto
        </label>
        <input
          id="sc-amount"
          className={ui.input}
          inputMode="numeric"
          autoComplete="off"
          placeholder="$ 0"
          value={amountText}
          aria-invalid={errors.amount ? 'true' : undefined}
          onChange={(e) => setAmountText(formatGroupedDigits(e.target.value))}
        />
        {errors.amount && <p className={ui.error}>{errors.amount}</p>}
      </div>
      <ChipGroup
        label="Se paga desde"
        options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        value={accountId}
        onChange={setAccountId}
      />
      {errors.account && <p className={ui.error}>{errors.account}</p>}
      <ChipGroup label="Frecuencia" options={FREQUENCIES} value={frequency} onChange={setFrequency} />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="sc-start">
          Fecha del primer pago
        </label>
        <input
          id="sc-start"
          type="date"
          className={ui.input}
          value={startDate}
          aria-invalid={errors.startDate ? 'true' : undefined}
          onChange={(e) => setStartDate(e.target.value)}
        />
        {errors.startDate && <p className={ui.error}>{errors.startDate}</p>}
      </div>
      {frequency !== 'ONCE' && (
        <div className={ui.field}>
          <label className={ui.label} htmlFor="sc-end">
            Fecha del último pago (opcional)
          </label>
          <input
            id="sc-end"
            type="date"
            className={ui.input}
            value={endDate}
            aria-invalid={errors.endDate ? 'true' : undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
          {errors.endDate && <p className={ui.error}>{errors.endDate}</p>}
        </div>
      )}
      {serverError && (
        <p role="alert" className={ui.alert}>
          {serverError}
        </p>
      )}
      <button type="submit" className={ui.button} disabled={pending}>
        {pending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar'}
      </button>
      {onCancel && (
        <button type="button" className={ui.buttonGhost} onClick={onCancel}>
          Cancelar
        </button>
      )}
    </form>
  );
}
