'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ActionResult } from '../lib/action-result';
import { feeImpactText } from '../lib/cards';
import { formatGroupedDigits, formatMoneyCompact, parseAmountInput } from '../lib/format';
import type { Account, FeeImpact, InstallmentView } from '../lib/types';
import { useSubmit } from '../lib/use-submit';
import { ChipGroup } from './ChipGroup';
import styles from './CreditCards.module.css';
import ui from './ui.module.css';

const digits = (text: string) => parseAmountInput(text) ?? '0';

/** Espacio bajo la fila donde se confirma una acción, sin salir de la lista. */
function Panel({ label, error, children }: { label: string; error: string | null; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={`${styles.panel} ${styles.tall}`}>
      {children}
      {error && (
        <p role="alert" className={ui.alert}>
          {error}
        </p>
      )}
    </div>
  );
}

interface PaymentFields {
  accounts: Account[];
  accountId: string;
  today: string;
  onCancel: () => void;
}

function usePaymentFields({ accountId: initialAccount, today }: Pick<PaymentFields, 'accountId' | 'today'>) {
  const [accountId, setAccountId] = useState(initialAccount);
  const [paidOn, setPaidOn] = useState(today);
  return { accountId, setAccountId, paidOn, setPaidOn };
}

function AccountAndDate({ accounts, fields }: { accounts: Account[]; fields: ReturnType<typeof usePaymentFields> }) {
  return (
    <>
      <ChipGroup label="Cuenta" options={accounts.map((a) => ({ value: a.id, label: a.name }))} value={fields.accountId} onChange={fields.setAccountId} />
      <div className={ui.field}>
        <label className={ui.label}>
          Fecha de pago
          <input type="date" className={ui.input} value={fields.paidOn} onChange={(e) => fields.setPaidOn(e.target.value)} />
        </label>
      </div>
    </>
  );
}

export function PayInstallmentPanel({ description, installment, onConfirm, onDone, accounts, accountId, today, onCancel }: PaymentFields & {
  description: string;
  installment: InstallmentView;
  onConfirm: (input: { fromAccountId: string; paidOn: string; interest: string; installment: number }) => Promise<ActionResult>;
  onDone: () => void;
}) {
  const fields = usePaymentFields({ accountId, today });
  const [interestText, setInterestText] = useState(formatGroupedDigits(installment.interest));
  const { pending, error, setError, submit } = useSubmit(onDone);
  const interest = digits(interestText);

  function confirm() {
    if (!fields.accountId || !fields.paidOn) {
      setError('Elige la cuenta y la fecha del pago.');
      return;
    }
    void submit(() => onConfirm({ fromAccountId: fields.accountId, paidOn: fields.paidOn, interest, installment: installment.number }));
  }

  return (
    <Panel label={`Pagar cuota de ${description}`} error={error}>
      <AccountAndDate accounts={accounts} fields={fields} />
      <p className={styles.line}>
        <span>Capital</span>
        <span className={styles.figure}>{formatMoneyCompact(installment.capital)}</span>
      </p>
      <div className={ui.field}>
        <label className={ui.label}>
          Intereses de esta cuota
          <input className={ui.input} inputMode="numeric" autoComplete="off" value={interestText} onChange={(e) => setInterestText(formatGroupedDigits(e.target.value))} />
        </label>
        <p className={styles.help}>Ajústalo si tu extracto dice otro valor.</p>
      </div>
      <p className={styles.total}>Total: {formatMoneyCompact(BigInt(installment.capital) + BigInt(interest))}</p>
      <div className={styles.actions}>
        <button type="button" className={ui.button} disabled={pending} onClick={confirm}>
          {pending ? 'Guardando…' : 'Confirmar pago'}
        </button>
        <button type="button" className={ui.buttonGhost} disabled={pending} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </Panel>
  );
}

export function PayFeePanel({ label, amount, onConfirm, onDone, accounts, accountId, today, onCancel }: PaymentFields & {
  label: string;
  amount: string;
  onConfirm: (input: { fromAccountId: string; paidOn: string; amount: string }) => Promise<ActionResult>;
  onDone: () => void;
}) {
  const fields = usePaymentFields({ accountId, today });
  const [amountText, setAmountText] = useState(formatGroupedDigits(amount));
  const { pending, error, setError, submit } = useSubmit(onDone);

  function confirm() {
    if (!fields.accountId || !fields.paidOn) {
      setError('Elige la cuenta y la fecha del pago.');
      return;
    }
    void submit(() => onConfirm({ fromAccountId: fields.accountId, paidOn: fields.paidOn, amount: digits(amountText) }));
  }

  return (
    <Panel label={label} error={error}>
      <AccountAndDate accounts={accounts} fields={fields} />
      <div className={ui.field}>
        <label className={ui.label}>
          Valor del manejo
          <input className={ui.input} inputMode="numeric" autoComplete="off" value={amountText} onChange={(e) => setAmountText(formatGroupedDigits(e.target.value))} />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="button" className={ui.button} disabled={pending} onClick={confirm}>
          {pending ? 'Guardando…' : 'Confirmar pago'}
        </button>
        <button type="button" className={ui.buttonGhost} disabled={pending} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </Panel>
  );
}

export function SettlePanel({ description, offer, onConfirm, onDone, accounts, accountId, today, onCancel }: PaymentFields & {
  description: string;
  offer: { capital: string; interest: string; total: string };
  onConfirm: (input: { fromAccountId: string; paidOn: string }) => Promise<ActionResult>;
  onDone: () => void;
}) {
  const fields = usePaymentFields({ accountId, today });
  const { pending, error, setError, submit } = useSubmit(onDone);

  function confirm() {
    if (!fields.accountId || !fields.paidOn) {
      setError('Elige la cuenta y la fecha del pago.');
      return;
    }
    void submit(() => onConfirm({ fromAccountId: fields.accountId, paidOn: fields.paidOn }));
  }

  return (
    <Panel label={`Liquidar ${description}`} error={error}>
      <p className={styles.summary}>
        Vas a pagar {formatMoneyCompact(offer.total)} y esta compra queda cerrada: {formatMoneyCompact(offer.capital)} de lo que debes y {formatMoneyCompact(offer.interest)} de intereses de la próxima cuota.
      </p>
      <p className={styles.warning}>Después de liquidar no se puede deshacer.</p>
      <AccountAndDate accounts={accounts} fields={fields} />
      <div className={styles.actions}>
        <button type="button" className={ui.buttonDanger} disabled={pending} onClick={confirm}>
          {pending ? 'Guardando…' : 'Sí, liquidar'}
        </button>
        <button type="button" className={ui.buttonGhost} disabled={pending} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </Panel>
  );
}

/** Confirmación que primero averigua qué cuotas de manejo se perderían; no deja confirmar hasta saberlo. */
export function FeeAwareConfirmPanel({ loadImpact, ...panel }: Omit<Parameters<typeof ConfirmPanel>[0], 'warning' | 'waiting'> & { loadImpact: () => Promise<FeeImpact> }) {
  const [state, setState] = useState<{ ready: boolean; warning: string | null }>({ ready: false, warning: null });
  useEffect(() => {
    let active = true;
    loadImpact().then(
      (impact) => active && setState({ ready: true, warning: feeImpactText(impact) }),
      () => active && setState({ ready: true, warning: null }),
    );
    return () => {
      active = false;
    };
    // Se calcula una sola vez, al abrir la confirmación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <ConfirmPanel {...panel} warning={state.warning} waiting={!state.ready} />;
}

export function ConfirmPanel({ label, text, confirmLabel, onConfirm, onDone, onCancel, warning, waiting }: {
  label: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => Promise<ActionResult>;
  onDone: () => void;
  onCancel: () => void;
  warning?: string | null;
  waiting?: boolean;
}) {
  const { pending, error, submit } = useSubmit(onDone);
  return (
    <Panel label={label} error={error}>
      <p className={styles.summary}>{text}</p>
      {warning && <p className={styles.warning}>{warning}</p>}
      <div className={styles.actions}>
        <button type="button" className={ui.buttonDanger} disabled={pending || waiting} onClick={() => void submit(onConfirm)}>
          {pending ? 'Guardando…' : confirmLabel}
        </button>
        <button type="button" className={ui.buttonGhost} disabled={pending} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </Panel>
  );
}
