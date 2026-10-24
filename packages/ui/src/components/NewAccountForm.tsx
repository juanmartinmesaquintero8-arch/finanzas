'use client';

import { useState, type FormEvent } from 'react';
import type { ActionResult } from '../lib/action-result';
import { formatGroupedDigits } from '../lib/format';
import type { Account, AccountType, CreateAccountInput } from '../lib/types';
import { ChipGroup } from './ChipGroup';
import styles from './Form.module.css';
import ui from './ui.module.css';

const TYPES: { value: AccountType; label: string }[] = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'BANK', label: 'Banco' },
  { value: 'DIGITAL', label: 'Digital' },
  { value: 'SAVINGS', label: 'Ahorros' },
  { value: 'CREDIT', label: 'Crédito' },
];

interface Props {
  onSubmit: (input: CreateAccountInput) => Promise<ActionResult>;
  onDone?: () => void;
  /** Si se pasa, el formulario edita esta cuenta (precargado) en vez de crear una nueva. */
  account?: Account;
  onCancel?: () => void;
}

export function NewAccountForm({ onSubmit, onDone, account, onCancel }: Props) {
  const editing = !!account;
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'CASH');
  const [balanceText, setBalanceText] = useState(account ? formatGroupedDigits(account.initialBalance.amount) : '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!name.trim()) {
      setNameError('Escribe un nombre para la cuenta.');
      return;
    }
    setNameError(null);
    setPending(true);
    try {
      const res = await onSubmit({
        name: name.trim(),
        type,
        initialBalance: balanceText.replace(/\D/g, '').replace(/^0+(?=\d)/, '') || '0',
      });
      if (res.ok) onDone?.();
      else setServerError(res.error);
    } catch {
      setServerError(editing ? 'No pudimos guardar la cuenta. Intenta de nuevo.' : 'No pudimos crear la cuenta. Intenta de nuevo.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={`${ui.card} ${styles.form}`} onSubmit={handleSubmit} noValidate>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="account-name">
          Nombre de la cuenta
        </label>
        <input
          id="account-name"
          className={ui.input}
          maxLength={80}
          autoComplete="off"
          placeholder="Ej: Bancolombia"
          value={name}
          aria-invalid={nameError ? 'true' : undefined}
          aria-describedby={nameError ? 'account-name-error' : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {nameError && (
          <p id="account-name-error" className={ui.error}>
            {nameError}
          </p>
        )}
      </div>
      <ChipGroup label="Tipo de cuenta" options={TYPES} value={type} onChange={setType} />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="account-balance">
          {editing ? 'Saldo inicial (con el que empezó la cuenta)' : 'Saldo actual'}
        </label>
        <input
          id="account-balance"
          className={ui.input}
          inputMode="numeric"
          autoComplete="off"
          placeholder="0"
          value={balanceText}
          onChange={(e) => setBalanceText(formatGroupedDigits(e.target.value))}
        />
      </div>
      {serverError && (
        <p role="alert" className={ui.alert}>
          {serverError}
        </p>
      )}
      <button type="submit" className={ui.button} disabled={pending}>
        {pending ? (editing ? 'Guardando…' : 'Creando…') : editing ? 'Guardar cambios' : 'Crear cuenta'}
      </button>
      {onCancel && (
        <button type="button" className={ui.buttonGhost} onClick={onCancel}>
          Cancelar
        </button>
      )}
    </form>
  );
}
