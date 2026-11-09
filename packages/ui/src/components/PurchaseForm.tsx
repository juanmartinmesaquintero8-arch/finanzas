'use client';

import { useState, type FormEvent } from 'react';
import { feeImpactText, installmentsOf, purchaseSummary, validatePurchaseForm, type CardsApi } from '../lib/cards';
import { formatDueDate, formatGroupedDigits, formatMoneyCompact } from '../lib/format';
import type { CardView, PurchaseInput, PurchasePreview, PurchaseView } from '../lib/types';
import { useSubmit } from '../lib/use-submit';
import type { FieldErrors } from '../lib/validation';
import { ChipGroup } from './ChipGroup';
import styles from './CreditCards.module.css';
import form from './Form.module.css';
import ui from './ui.module.css';

const INSTALLMENT_OPTIONS = ['1', '3', '6', '12', '24', '36', 'Otro'].map((v) => ({ value: v, label: v }));
const PREVIEW_ROWS = 3;

interface Props {
  cards: CardView[];
  today: string;
  api: CardsApi;
  initialCardId?: string;
  /** Si se pasa, edita esta compra. */
  purchase?: PurchaseView;
  onDone: (notice?: string) => void;
  onCancel: () => void;
}

function initialChoice(purchase?: PurchaseView): string {
  if (!purchase) return '1';
  return INSTALLMENT_OPTIONS.some((o) => o.value === String(purchase.installments)) ? String(purchase.installments) : 'Otro';
}

export function PurchaseForm({ cards, today, api, initialCardId, purchase, onDone, onCancel }: Props) {
  const locked = !!purchase && (purchase.paidInstallments > 0 || !!purchase.closedOn);
  const [cardId, setCardId] = useState(purchase?.cardId ?? initialCardId ?? (cards.length === 1 ? cards[0]!.id : ''));
  const [description, setDescription] = useState(purchase?.description ?? '');
  const [amountText, setAmountText] = useState(purchase ? formatGroupedDigits(purchase.amount) : '');
  const [choice, setChoice] = useState(initialChoice(purchase));
  const [otherText, setOtherText] = useState(purchase ? String(purchase.installments) : '');
  const [purchaseDate, setPurchaseDate] = useState(purchase?.purchaseDate ?? today);
  const [editedFirstDue, setEditedFirstDue] = useState<string | null>(purchase?.firstDueDate ?? null);
  const [category, setCategory] = useState(purchase?.category ?? '');
  const [paidText, setPaidText] = useState('');
  const [interestOverride, setInterestOverride] = useState<boolean | null>(purchase ? purchase.monthlyRatePpm === 0 : null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ input: PurchaseInput; preview: PurchasePreview; warning: string | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { pending, error, submit } = useSubmit(onDone);

  const card = cards.find((c) => c.id === cardId);
  const firstDueDate = editedFirstDue ?? (card ? api.suggestFirstDueDate(card, purchaseDate) : null) ?? '';
  const installments = installmentsOf(choice, otherText);
  const withoutInterest = !!card?.chargesInterest && (interestOverride ?? installments === 1);

  function save(input: PurchaseInput) {
    void submit(() => (purchase ? api.updatePurchase(purchase.id, input) : api.addPurchase(input)));
  }

  function handleLockedSubmit(e: FormEvent) {
    e.preventDefault();
    if (!purchase) return;
    if (!description.trim()) {
      setErrors({ description: 'Escribe qué compraste.' });
      return;
    }
    setErrors({});
    save({
      cardId: purchase.cardId,
      description: description.trim(),
      amount: purchase.amount,
      installments: purchase.installments,
      purchaseDate: purchase.purchaseDate,
      firstDueDate: purchase.firstDueDate,
      category: category.trim(),
      paidInstallments: purchase.paidInstallments,
      withoutInterest: purchase.monthlyRatePpm === 0,
    });
  }

  /** Editar: ¿cambia alguna cifra o fecha, o solo los textos? */
  function changesNumbers(input: PurchaseInput, p: PurchaseView): boolean {
    return (
      input.amount !== p.amount ||
      input.installments !== p.installments ||
      input.purchaseDate !== p.purchaseDate ||
      input.firstDueDate !== p.firstDueDate ||
      (input.paidInstallments ?? 0) !== p.paidInstallments ||
      (!!card?.chargesInterest && !!input.withoutInterest !== (p.monthlyRatePpm === 0))
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const result = validatePurchaseForm({
      cardId, description, amountText, installmentsChoice: choice, otherInstallmentsText: otherText, purchaseDate, firstDueDate, category, paidText, withoutInterest,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    // Editar solo textos no toca ninguna cifra: se guarda directo.
    if (purchase && !changesNumbers(result.value, purchase)) {
      save(result.value);
      return;
    }
    const previewed = api.previewPurchase(card!, result.value, purchase);
    if (!previewed.ok) {
      setFormError(previewed.error);
      return;
    }
    let warning: string | null = null;
    if (purchase) {
      setChecking(true);
      warning = feeImpactText(await api.purchaseChangeImpact(purchase.id, result.value).finally(() => setChecking(false)));
    }
    setShowAll(false);
    setConfirming({ input: result.value, preview: previewed.preview, warning });
  }

  if (confirming) {
    const { preview, input, warning } = confirming;
    const rows = showAll ? preview.installments : preview.installments.slice(0, PREVIEW_ROWS);
    const hasInterest = BigInt(preview.totalInterest) > 0n;
    return (
      <section className={`${ui.card} ${ui.stack} ${styles.tall}`} aria-label="Confirmar compra">
        <p className={styles.summary}>{purchaseSummary(preview, today)}</p>
        {rows.length > 0 && (
          <ul className={styles.previewList}>
            {rows.map((i) => (
              <li key={i.number} className={styles.previewRow}>
                <span>
                  Cuota {i.number} · {formatDueDate(i.dueDate, today)}
                </span>
                <span className={styles.figure}>{formatMoneyCompact(i.total)}</span>
              </li>
            ))}
          </ul>
        )}
        {preview.installments.length > PREVIEW_ROWS && (
          <button type="button" className={ui.buttonGhost} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Ver menos' : `Ver las ${preview.installments.length}`}
          </button>
        )}
        {hasInterest && preview.remainingCount > 1 && <p className={styles.help}>La cuota baja cada mes porque los intereses se calculan sobre lo que aún debes.</p>}
        {hasInterest && <p className={styles.help}>Es un estimado: tu banco puede calcular un poco distinto.</p>}
        {warning && <p className={styles.warning}>{warning}</p>}
        {error && (
          <p role="alert" className={ui.alert}>
            {error}
          </p>
        )}
        <button type="button" className={ui.button} disabled={pending} onClick={() => save(input)}>
          {pending ? 'Guardando…' : 'Sí, guardar la compra'}
        </button>
        <button type="button" className={ui.buttonGhost} disabled={pending} onClick={() => setConfirming(null)}>
          Corregir
        </button>
      </section>
    );
  }

  const textFields = (
    <>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="cp-description">
          Qué compraste
        </label>
        <input id="cp-description" className={ui.input} maxLength={160} autoComplete="off" value={description} aria-invalid={errors.description ? 'true' : undefined} onChange={(e) => setDescription(e.target.value)} />
        {errors.description && <p className={ui.error}>{errors.description}</p>}
      </div>
    </>
  );
  const categoryField = (
    <div className={ui.field}>
      <label className={ui.label} htmlFor="cp-category">
        Categoría (opcional)
      </label>
      <input id="cp-category" className={ui.input} maxLength={60} autoComplete="off" value={category} onChange={(e) => setCategory(e.target.value)} />
    </div>
  );
  const buttons = (
    <>
      {(error || formError) && (
        <p role="alert" className={ui.alert}>
          {error ?? formError}
        </p>
      )}
      <button type="submit" className={ui.button} disabled={pending || checking}>
        {pending ? 'Guardando…' : purchase ? 'Guardar cambios' : 'Continuar'}
      </button>
      <button type="button" className={ui.buttonGhost} onClick={onCancel}>
        Cancelar
      </button>
    </>
  );

  if (locked) {
    return (
      <form className={`${ui.card} ${form.form} ${styles.tall}`} onSubmit={handleLockedSubmit} noValidate>
        <p className={styles.help}>Esta compra ya tiene cuotas pagadas: solo puedes cambiar la descripción y la categoría.</p>
        {textFields}
        {categoryField}
        {buttons}
      </form>
    );
  }

  return (
    <form className={`${ui.card} ${form.form} ${styles.tall}`} onSubmit={handleSubmit} noValidate>
      {!purchase && <ChipGroup label="Tarjeta" options={cards.map((c) => ({ value: c.id, label: c.name }))} value={cardId} onChange={setCardId} />}
      {errors.card && <p className={ui.error}>{errors.card}</p>}
      {textFields}
      <div className={ui.field}>
        <label className={ui.label} htmlFor="cp-amount">
          Monto
        </label>
        <input id="cp-amount" className={ui.input} inputMode="numeric" autoComplete="off" placeholder="$ 0" value={amountText} aria-invalid={errors.amount ? 'true' : undefined} onChange={(e) => setAmountText(formatGroupedDigits(e.target.value))} />
        {errors.amount && <p className={ui.error}>{errors.amount}</p>}
      </div>
      <ChipGroup label="Número de cuotas" options={INSTALLMENT_OPTIONS} value={choice} onChange={setChoice} />
      {choice === 'Otro' && (
        <div className={ui.field}>
          <label className={ui.label} htmlFor="cp-other">
            ¿Cuántas cuotas?
          </label>
          <input id="cp-other" className={ui.input} inputMode="numeric" maxLength={2} autoComplete="off" placeholder="1 a 72" value={otherText} onChange={(e) => setOtherText(e.target.value.replace(/\D/g, ''))} />
        </div>
      )}
      {errors.installments && <p className={ui.error}>{errors.installments}</p>}
      <div className={ui.field}>
        <label className={ui.label} htmlFor="cp-date">
          Fecha de la compra
        </label>
        <input id="cp-date" type="date" className={ui.input} value={purchaseDate} aria-invalid={errors.purchaseDate ? 'true' : undefined} onChange={(e) => setPurchaseDate(e.target.value)} />
        {errors.purchaseDate && <p className={ui.error}>{errors.purchaseDate}</p>}
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="cp-first">
          Primera cuota
        </label>
        <input id="cp-first" type="date" className={ui.input} value={firstDueDate} aria-invalid={errors.firstDueDate ? 'true' : undefined} onChange={(e) => setEditedFirstDue(e.target.value)} />
        {errors.firstDueDate && <p className={ui.error}>{errors.firstDueDate}</p>}
      </div>
      {categoryField}
      <div className={ui.field}>
        <label className={ui.label} htmlFor="cp-paid">
          Cuotas ya pagadas (opcional)
        </label>
        <input id="cp-paid" className={ui.input} inputMode="numeric" maxLength={2} autoComplete="off" placeholder="0" value={paidText} aria-invalid={errors.paid ? 'true' : undefined} onChange={(e) => setPaidText(e.target.value.replace(/\D/g, ''))} />
        <p className={styles.help}>Si la compra es de antes, pon cuántas cuotas ya pagaste. No se crean movimientos.</p>
        {errors.paid && <p className={ui.error}>{errors.paid}</p>}
      </div>
      {card?.chargesInterest && (
        <label className={styles.switch}>
          <span>Esta compra me la dieron sin intereses</span>
          <input type="checkbox" role="switch" checked={withoutInterest} onChange={(e) => setInterestOverride(e.target.checked)} />
        </label>
      )}
      {buttons}
    </form>
  );
}
