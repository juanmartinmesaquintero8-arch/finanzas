'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CARD_CHANGED, extraOutcome, monthAndYear, newPaymentId, type CardsApi } from '../lib/cards';
import { formatDueDate, formatGroupedDigits, formatMoneyCompact, formatMonthLong, parseAmountInput } from '../lib/format';
import type { Account, CardPaymentPreview, CardPaymentPreviewInput, CardPaymentPreviewResult, CardView, ExtraMode } from '../lib/types';
import { useSubmit } from '../lib/use-submit';
import { ChipGroup } from './ChipGroup';
import styles from './CreditCards.module.css';
import form from './Form.module.css';
import ui from './ui.module.css';

const money = formatMoneyCompact;
const FAILED: CardPaymentPreviewResult = { ok: false, error: 'No pudimos calcular el pago. Intenta de nuevo.' };
const PAID = 'Pago registrado.';

interface Props {
  card: CardView;
  accounts: Account[];
  today: string;
  api: CardsApi;
  onDone: (notice?: string) => void;
  onCancel: () => void;
}

interface Review {
  input: CardPaymentPreviewInput;
  preview: CardPaymentPreview;
}

/**
 * Un pago por tarjeta, como el del extracto: primero el monto, la cuenta y la fecha; después el desglose
 * que calcula el servicio, y se guarda exactamente ese desglose (con su firma). Sólo presentación.
 */
export function CardPaymentForm({ card, accounts, today, api, onDone, onCancel }: Props) {
  // Se crea al abrir: si el mismo pago llega dos veces, el servicio no lo registra otra vez.
  const [paymentId, setPaymentId] = useState(newPaymentId);
  const [amountText, setAmountText] = useState('');
  const [accountId, setAccountId] = useState(accounts.some((a) => a.id === card.paymentAccountId) ? card.paymentAccountId : '');
  const [paidOn, setPaidOn] = useState(today);
  const [shortcuts, setShortcuts] = useState<{ thisMonth: string; max: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [mode, setMode] = useState<ExtraMode>('SHORTEN');
  const [refreshing, setRefreshing] = useState(false);
  // Cada cálculo lleva un turno: una respuesta que llega tarde (de un destino viejo o tras «Corregir») se descarta.
  const latest = useRef(0);
  const amountRef = useRef<HTMLInputElement>(null);
  const backToForm = useRef(false);
  const errorId = useId();
  const { pending, error, submit } = useSubmit((notice) => {
    setPaymentId(newPaymentId());
    onDone(notice ?? PAID);
  });

  // Los atajos dependen del día del pago: lo que vence y el máximo cambian con la fecha.
  useEffect(() => {
    let active = true;
    setShortcuts(null);
    if (!paidOn) return undefined;
    api.paymentShortcuts(card.id, paidOn).then(
      (r) => active && setShortcuts(r.ok ? { thisMonth: r.thisMonth, max: r.max } : null),
      () => active && setShortcuts(null),
    );
    return () => {
      active = false;
    };
  }, [api, card.id, paidOn]);

  // Al volver del desglose, se sigue escribiendo en el monto.
  useEffect(() => {
    if (review === null && backToForm.current) {
      backToForm.current = false;
      amountRef.current?.focus();
    }
  }, [review]);

  const preview = (input: CardPaymentPreviewInput) => api.previewCardPayment(card.id, input).catch(() => FAILED);

  async function handleContinue(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!accountId || !paidOn) {
      setFormError('Elige la cuenta y la fecha del pago.');
      return;
    }
    const input: CardPaymentPreviewInput = { amount: parseAmountInput(amountText) ?? '0', paidOn, fromAccountId: accountId };
    const ticket = ++latest.current;
    setChecking(true);
    const result = await preview(input);
    if (ticket !== latest.current) return;
    setChecking(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setMode('SHORTEN');
    setReview({ input, preview: result.preview });
  }

  async function chooseTarget(purchaseId: string) {
    if (!review || purchaseId === review.preview.extraPurchaseId) return;
    const input: CardPaymentPreviewInput = { ...review.input, extraPurchaseId: purchaseId };
    const ticket = ++latest.current;
    setRefreshing(true);
    const result = await preview(input);
    if (ticket !== latest.current) return;
    setRefreshing(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setFormError(null);
    setReview({ input, preview: result.preview });
  }

  /** Si la tarjeta cambió, se muestra el desglose nuevo (con el aviso) en lugar del viejo. */
  async function recalculate(input: CardPaymentPreviewInput) {
    const ticket = ++latest.current;
    const result = await preview(input);
    if (ticket !== latest.current) return;
    if (result.ok) setReview({ input, preview: result.preview });
    else {
      setFormError(result.error);
      setReview(null);
    }
  }

  function confirm() {
    if (!review) return;
    const { input, preview: shown } = review;
    const extra = shown.needsMode && shown.extraPurchaseId ? { extraPurchaseId: shown.extraPurchaseId, mode } : {};
    void submit(async () => {
      const result = await api.payCard(card.id, { amount: input.amount, paidOn: input.paidOn, fromAccountId: input.fromAccountId, ...extra, paymentId, expected: shown.signature });
      if (!result.ok && result.error === CARD_CHANGED) await recalculate(input);
      return result;
    });
  }

  function back() {
    latest.current++;
    setRefreshing(false);
    setFormError(null);
    backToForm.current = true;
    setReview(null);
  }

  function cancel() {
    setPaymentId(newPaymentId());
    onCancel();
  }

  if (review) {
    return (
      <Breakdown
        preview={review.preview}
        today={today}
        mode={mode}
        onMode={setMode}
        onTarget={(id) => void chooseTarget(id)}
        busy={pending || refreshing}
        pending={pending}
        error={error ?? formError}
        onConfirm={confirm}
        onBack={back}
      />
    );
  }

  const thisMonth = shortcuts && BigInt(shortcuts.thisMonth) > 0n ? shortcuts.thisMonth : null;
  const max = shortcuts && BigInt(shortcuts.max) > 0n ? shortcuts.max : null;
  return (
    <form className={`${ui.card} ${form.form} ${styles.tall}`} onSubmit={handleContinue} noValidate aria-label={`Pagar tarjeta ${card.name}`}>
      <div className={styles.head}>
        <h2 className={styles.name}>{card.name}</h2>
        <p className={styles.next}>Debes en total {money(card.debt)}</p>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="cpay-amount">
          ¿Cuánto pagaste?
        </label>
        <input
          ref={amountRef}
          id="cpay-amount"
          className={ui.input}
          inputMode="numeric"
          autoComplete="off"
          placeholder="$ 0"
          value={amountText}
          aria-invalid={formError ? 'true' : undefined}
          aria-describedby={formError ? errorId : undefined}
          onChange={(e) => setAmountText(formatGroupedDigits(e.target.value))}
        />
        {(thisMonth || max) && (
          <div className={`${ui.chips} ${styles.shortcuts}`}>
            {thisMonth && <Shortcut label="Lo de este mes" amount={thisMonth} onPick={setAmountText} />}
            {max && <Shortcut label="Todo" amount={max} onPick={setAmountText} />}
          </div>
        )}
      </div>
      <ChipGroup label="Se pagó desde" options={accounts.map((a) => ({ value: a.id, label: a.name }))} value={accountId} onChange={setAccountId} />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="cpay-date">
          Fecha del pago
        </label>
        <input id="cpay-date" type="date" className={ui.input} max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </div>
      {formError && (
        <p id={errorId} role="alert" className={ui.alert}>
          {formError}
        </p>
      )}
      <button type="submit" className={ui.button} disabled={checking}>
        {checking ? 'Calculando…' : 'Continuar'}
      </button>
      <button type="button" className={ui.buttonGhost} onClick={cancel}>
        Cancelar
      </button>
    </form>
  );
}

function Shortcut({ label, amount, onPick }: { label: string; amount: string; onPick: (text: string) => void }) {
  return (
    <button type="button" className={`${ui.chip} ${styles.shortcut}`} onClick={() => onPick(formatGroupedDigits(amount))}>
      <span>{label}</span>
      <span className={styles.shortcutAmount}>{money(amount)}</span>
    </button>
  );
}

/** Ayuda de «Terminar antes»: nombra la compra que sigue debiendo y dice si su fecha final cambia. */
function shortenHelp(name: string, outcome: NonNullable<ReturnType<typeof extraOutcome>>): string {
  if (outcome.SHORTEN.endDate === outcome.LOWER.endDate) return `${name} termina en la misma fecha, con una última cuota más pequeña.`;
  return `Pagas las mismas cuotas, pero ${name} termina en ${monthAndYear(outcome.SHORTEN.endDate!)}. Te ahorras más intereses.`;
}

function Breakdown({ preview, today, mode, onMode, onTarget, busy, pending, error, onConfirm, onBack }: {
  preview: CardPaymentPreview;
  today: string;
  mode: ExtraMode;
  onMode: (mode: ExtraMode) => void;
  onTarget: (purchaseId: string) => void;
  busy: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const titleId = useId();
  const questionId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Quien usa lector de pantalla oye primero el total del desglose.
  useEffect(() => heading.current?.focus(), []);
  const outcome = preview.needsMode ? extraOutcome(preview) : null;
  const nameOf = (purchaseId: string) => preview.purchases.find((p) => p.purchaseId === purchaseId)?.description ?? preview.extraTargets.find((t) => t.purchaseId === purchaseId)?.description ?? '';
  return (
    <section className={`${ui.card} ${ui.stack} ${styles.tall}`} aria-labelledby={titleId}>
      <h2 id={titleId} ref={heading} tabIndex={-1} className={styles.reviewTitle}>
        Así se reparte tu pago de {money(preview.total)}
      </h2>
      <ul className={styles.previewList}>
        {preview.fees.map((f) => (
          <li key={f.month} className={styles.splitRow}>
            <strong>Manejo {formatMonthLong(f.month)}:</strong> {money(f.amount)}
          </li>
        ))}
        {preview.purchases.map((p) => (
          <li key={p.purchaseId} className={styles.splitRow}>
            <strong>{p.description}:</strong> {money(BigInt(p.capital) + BigInt(p.extraCapital))} de capital y {money(p.interest)} de intereses
            {p.paidOff && `. ${p.description} queda pagada.`}
          </li>
        ))}
      </ul>
      {BigInt(preview.pending) > 0n && <p className={styles.warning}>Queda vencido {money(preview.pending)}. Sigue vencido y el interés del próximo mes sube un poco.</p>}
      {preview.dueSoon && (
        <p className={styles.warning}>
          Te faltan {money(preview.dueSoon.amount)} que vencen el {formatDueDate(preview.dueSoon.dueDate, today)}. Si no los pagas antes, quedan vencidos y el interés del próximo mes sube un poco.
        </p>
      )}
      {outcome && (
        <div role="radiogroup" aria-labelledby={questionId} className={styles.choices}>
          <p id={questionId} className={styles.question}>
            Te sobran {money(preview.extraCapital)}. ¿Qué quieres hacer con esa plata?
          </p>
          <Choice value="SHORTEN" title="Terminar antes" help={shortenHelp(nameOf(outcome.purchaseId), outcome)} mode={mode} onMode={onMode} />
          <Choice value="LOWER" title="Bajar la cuota" help={`Terminas en la misma fecha y la próxima cuota baja a ${money(outcome.LOWER.nextInstallment)}.`} mode={mode} onMode={onMode} />
        </div>
      )}
      {preview.needsMode && preview.extraTargets.length > 1 && (
        <div className={ui.field}>
          <ChipGroup
            label="¿A qué compra va la plata de más?"
            options={preview.extraTargets.map((t) => ({ value: t.purchaseId, label: t.description }))}
            value={preview.extraPurchaseId ?? ''}
            onChange={onTarget}
          />
          <p className={styles.help}>Te sugerimos la de mayor interés.</p>
        </div>
      )}
      {error && (
        <p role="alert" className={ui.alert}>
          {error}
        </p>
      )}
      <button type="button" className={ui.button} disabled={busy} onClick={onConfirm}>
        {pending ? 'Guardando…' : 'Sí, registrar el pago'}
      </button>
      <button type="button" className={ui.buttonGhost} disabled={pending} onClick={onBack}>
        Corregir
      </button>
    </section>
  );
}

function Choice({ value, title, help, mode, onMode }: { value: ExtraMode; title: string; help: string; mode: ExtraMode; onMode: (mode: ExtraMode) => void }) {
  const id = useId();
  return (
    <div className={styles.choice}>
      <input id={id} type="radio" name="extra-mode" className={styles.choiceInput} checked={mode === value} aria-describedby={`${id}-help`} onChange={() => onMode(value)} />
      <div className={styles.choiceText}>
        {/* La etiqueta cubre toda la opción (ver CSS): se toca en cualquier parte, y su nombre es solo el título. */}
        <label htmlFor={id} className={styles.choiceTitle}>
          {title}
        </label>
        <span id={`${id}-help`} className={styles.help}>
          {help}
        </span>
      </div>
    </div>
  );
}
