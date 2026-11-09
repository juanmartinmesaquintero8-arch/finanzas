'use client';

import { useState, type FormEvent } from 'react';
import type { ActionResult } from '../lib/action-result';
import { validateCardForm, type CardsApi } from '../lib/cards';
import { formatGroupedDigits } from '../lib/format';
import type { Account, CardFeeKind, CardInput, CardView, RateBasis } from '../lib/types';
import { useSubmit } from '../lib/use-submit';
import type { FieldErrors } from '../lib/validation';
import { ChipGroup } from './ChipGroup';
import styles from './CreditCards.module.css';
import form from './Form.module.css';
import ui from './ui.module.css';

const FEE_OPTIONS: { value: CardFeeKind; label: string }[] = [
  { value: 'NONE', label: 'No cobra' },
  { value: 'FIXED_MONTHLY', label: 'Todos los meses' },
  { value: 'ON_MOVEMENT', label: 'Solo los meses que uso la tarjeta' },
];
const INTEREST_OPTIONS: { value: 'NO' | 'YES'; label: string }[] = [
  { value: 'NO', label: 'Sin intereses' },
  { value: 'YES', label: 'Con intereses' },
];
const BASIS_OPTIONS: { value: RateBasis; label: string }[] = [
  { value: 'MV', label: 'Mensual (M.V.)' },
  { value: 'EA', label: 'Anual (E.A.)' },
];

interface Props {
  accounts: Account[];
  checkRate: CardsApi['checkRate'];
  onSubmit: (input: CardInput) => Promise<ActionResult>;
  onDone: () => void;
  onCancel: () => void;
  /** Si se pasa, edita esta tarjeta. */
  card?: CardView;
}

export function CardForm({ accounts, checkRate, onSubmit, onDone, onCancel, card }: Props) {
  const [name, setName] = useState(card?.name ?? '');
  const [dueDayText, setDueDayText] = useState(card ? String(card.dueDay) : '');
  const [paymentAccountId, setPaymentAccountId] = useState(card?.paymentAccountId ?? '');
  const [feeKind, setFeeKind] = useState<CardFeeKind>(card?.feeKind ?? 'NONE');
  const [feeAmountText, setFeeAmountText] = useState(card?.feeAmount ? formatGroupedDigits(card.feeAmount) : '');
  const [hasInterest, setHasInterest] = useState(card?.chargesInterest ?? false);
  const [rateBasis, setRateBasis] = useState<RateBasis>(card?.rateBasis ?? 'MV');
  const [rateText, setRateText] = useState(card?.rateText ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const { pending, error, submit } = useSubmit(onDone);

  const looksAnnual = hasInterest && rateText.trim() !== '' && !!checkRate(rateText, rateBasis).warning;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = validateCardForm({ name, dueDayText, paymentAccountId, feeKind, feeAmountText, hasInterest, rateBasis, rateText }, checkRate);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    void submit(() => onSubmit(result.value));
  }

  return (
    <form className={`${ui.card} ${form.form} ${styles.tall}`} onSubmit={handleSubmit} noValidate>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="cc-name">
          Nombre
        </label>
        <input id="cc-name" className={ui.input} maxLength={80} autoComplete="off" placeholder="Ej: Visa Bancolombia" value={name} aria-invalid={errors.name ? 'true' : undefined} onChange={(e) => setName(e.target.value)} />
        {errors.name && <p className={ui.error}>{errors.name}</p>}
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="cc-day">
          Día en que pagas
        </label>
        <input id="cc-day" className={ui.input} inputMode="numeric" maxLength={2} autoComplete="off" placeholder="1 a 31" value={dueDayText} aria-invalid={errors.dueDay ? 'true' : undefined} onChange={(e) => setDueDayText(e.target.value.replace(/\D/g, ''))} />
        {errors.dueDay && <p className={ui.error}>{errors.dueDay}</p>}
      </div>
      <ChipGroup label="Se paga desde" options={accounts.map((a) => ({ value: a.id, label: a.name }))} value={paymentAccountId} onChange={setPaymentAccountId} />
      {errors.account && <p className={ui.error}>{errors.account}</p>}
      <div className={ui.field}>
        <ChipGroup label="Cuota de manejo" options={FEE_OPTIONS} value={feeKind} onChange={setFeeKind} />
        <p className={styles.help}>Algunos bancos cobran el manejo únicamente en los meses en que haces una compra. Elige esto si tu banco te lo cobra así.</p>
      </div>
      {feeKind !== 'NONE' && (
        <div className={ui.field}>
          <label className={ui.label} htmlFor="cc-fee">
            Monto
          </label>
          <input id="cc-fee" className={ui.input} inputMode="numeric" autoComplete="off" placeholder="$ 0" value={feeAmountText} aria-invalid={errors.feeAmount ? 'true' : undefined} onChange={(e) => setFeeAmountText(formatGroupedDigits(e.target.value))} />
          {errors.feeAmount && <p className={ui.error}>{errors.feeAmount}</p>}
        </div>
      )}
      <ChipGroup label="Intereses" options={INTEREST_OPTIONS} value={hasInterest ? 'YES' : 'NO'} onChange={(v) => setHasInterest(v === 'YES')} />
      {hasInterest && (
        <>
          <ChipGroup label="Tipo de tasa" options={BASIS_OPTIONS} value={rateBasis} onChange={setRateBasis} />
          <div className={ui.field}>
            <label className={ui.label} htmlFor="cc-rate">
              Tasa
            </label>
            <div className={styles.rate}>
              <input id="cc-rate" className={ui.input} inputMode="decimal" autoComplete="off" placeholder="1,87" value={rateText} aria-invalid={errors.rate ? 'true' : undefined} onChange={(e) => setRateText(e.target.value)} />
              <span aria-hidden="true">%</span>
            </div>
            <p className={styles.help}>Búscala en tu extracto. Si ves &quot;M.V.&quot; es la tasa de cada mes; si ves &quot;E.A.&quot; es la del año completo. Pon la que tengas y nosotros la convertimos.</p>
            {errors.rate && <p className={ui.error}>{errors.rate}</p>}
            {looksAnnual && (
              <p role="status" className={styles.warning}>
                Esa tasa parece muy alta. Revisa que no sea la anual puesta como mensual.
              </p>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className={ui.alert}>
          {error}
        </p>
      )}
      <button type="submit" className={ui.button} disabled={pending}>
        {pending ? 'Guardando…' : card ? 'Guardar cambios' : 'Guardar tarjeta'}
      </button>
      <button type="button" className={ui.buttonGhost} onClick={onCancel}>
        Cancelar
      </button>
    </form>
  );
}
