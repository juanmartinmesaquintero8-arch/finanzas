import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { purchaseSummary, validateCardForm, validatePurchaseForm, type CardFormValues, type CardsApi, type PurchaseFormValues } from '../lib/cards';
import { formatDueDate } from '../lib/format';
import type { Account, CardView, Projection, PurchasePreview, PurchaseView } from '../lib/types';
import { CardDebtStat } from './CardDebtStat';
import { CardForm } from './CardForm';
import { CardsScreen } from './CardsScreen';
import { PurchaseForm } from './PurchaseForm';
import { ScheduledKindSwitch } from './ScheduledKindSwitch';
import { UpcomingCommitments } from './UpcomingCommitments';

const TODAY = '2026-11-08';
const cop = (amount: string) => ({ amount, currency: 'COP' });
const accounts: Account[] = [
  { id: 'bc', name: 'Bancolombia', type: 'BANK', initialBalance: cop('0') },
  { id: 'nu', name: 'Nu', type: 'DIGITAL', initialBalance: cop('0') },
];

const installment = (number: number, dueDate: string, total: string, capital = '100000', interest = '24000') => ({ number, dueDate, capital, interest, total });

const preview12: PurchasePreview = {
  totalCount: 12,
  remainingCount: 12,
  installments: Array.from({ length: 12 }, (_, i) => installment(i + 1, i === 0 ? '2026-12-15' : `2027-${String(i).padStart(2, '0')}-15`, String(124000 - i * 2000))),
  totalInterest: '156000',
  totalToPay: '1356000',
};

const purchase = (over: Partial<PurchaseView> = {}): PurchaseView => ({
  id: 'p1',
  cardId: 'c1',
  description: 'Nevera',
  category: 'Hogar',
  amount: '1200000',
  installments: 12,
  paidInstallments: 3,
  purchaseDate: '2026-08-02',
  firstDueDate: '2026-09-15',
  monthlyRatePpm: 20000,
  closedOn: null,
  next: installment(4, '2026-12-15', '118000', '100000', '18000'),
  settle: { capital: '900000', interest: '18000', total: '918000' },
  ...over,
});

const card = (over: Partial<CardView> = {}): CardView => ({
  id: 'c1',
  name: 'Visa Bancolombia',
  dueDay: 15,
  paymentAccountId: 'nu',
  feeKind: 'FIXED_MONTHLY',
  feeAmount: '18000',
  rateBasis: 'MV',
  rateText: '2',
  monthlyRatePpm: 20000,
  chargesInterest: true,
  debt: '900000',
  next: { amount: '118000', date: '2026-12-15' },
  purchases: [purchase()],
  pendingFees: [{ month: '2026-11', dueDate: '2026-12-15', amount: '18000' }],
  ...over,
});

function api(over: Partial<CardsApi> = {}): CardsApi {
  const ok = () => vi.fn().mockResolvedValue({ ok: true });
  return {
    createCard: ok(),
    updateCard: ok(),
    removeCard: ok(),
    addPurchase: ok(),
    updatePurchase: ok(),
    removePurchase: ok(),
    payInstallment: ok(),
    undoLastPayment: ok(),
    settle: ok(),
    payFee: ok(),
    checkRate: vi.fn((text: string) => (text === '5' ? { warning: true } : text === '11' ? { error: 'La tasa M.V. no puede superar 10 %' } : {})),
    suggestFirstDueDate: vi.fn((_card: { dueDay: number }, date: string) => (date ? '2026-12-15' : null)),
    previewPurchase: vi.fn(() => ({ ok: true as const, preview: preview12 })),
    ...over,
  };
}

const RATE_ZERO = 'La tasa debe ser mayor que 0. Si no cobra intereses, elige "Sin intereses".';

describe('selector y piezas de Inicio', () => {
  it('Gastos | Ingresos | Tarjetas, con la activa marcada', () => {
    render(<ScheduledKindSwitch active="cards" expensesHref="/p" incomesHref="/p?tipo=ingresos" cardsHref="/p?tipo=tarjetas" />);
    expect(screen.getByRole('link', { name: 'Tarjetas' })).toHaveAttribute('href', '/p?tipo=tarjetas');
    expect(screen.getByRole('link', { name: 'Tarjetas' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Gastos' })).not.toHaveAttribute('aria-current');
  });

  it('sin enlace de tarjetas el selector sigue como antes', () => {
    render(<ScheduledKindSwitch active="expenses" expensesHref="/p" incomesHref="/p?tipo=ingresos" />);
    expect(screen.queryByRole('link', { name: 'Tarjetas' })).toBeNull();
  });

  it('dos cuotas vencidas de la misma compra en la misma fecha no repiten clave', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const base = { scheduledExpenseId: 'p1', accountId: 'a', date: '2026-11-08', amount: cop('1') };
    const commitments: Projection['commitments'] = [
      { ...base, description: 'Nevera (cuota 1/12)' },
      { ...base, description: 'Nevera (cuota 2/12)' },
    ];
    render(<UpcomingCommitments commitments={commitments} accountNames={new Map()} />);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('Deuda total en tarjetas', () => {
    render(<CardDebtStat debt="1800000" />);
    expect(screen.getByText('Deuda total en tarjetas')).toBeInTheDocument();
    expect(screen.getByText('$1.800.000')).toBeInTheDocument();
  });
});

describe('textos de fechas y resumen', () => {
  it('la fecha lleva el año solo si no es el de hoy', () => {
    expect(formatDueDate('2026-12-15', TODAY)).toBe('15 dic');
    expect(formatDueDate('2027-11-15', TODAY)).toBe('15 nov 2027');
  });

  it('resumen de 12 cuotas con el texto exacto', () => {
    const p: PurchasePreview = {
      ...preview12,
      installments: [installment(1, '2026-12-15', '124000'), installment(12, '2027-11-15', '102000')],
    };
    expect(purchaseSummary(p, TODAY)).toBe('Vas a pagar 12 cuotas. La primera: $124.000 el 15 dic. La última: $102.000 el 15 nov 2027. Intereses en total: $156.000. Total a pagar: $1.356.000.');
  });

  it('una sola cuota, compras antiguas y todo pagado', () => {
    const one: PurchasePreview = { totalCount: 1, remainingCount: 1, installments: [installment(1, '2026-12-15', '50000')], totalInterest: '0', totalToPay: '50000' };
    expect(purchaseSummary(one, TODAY)).toBe('Vas a pagar 1 cuota: $50.000 el 15 dic. Intereses en total: $0. Total a pagar: $50.000.');
    const old: PurchasePreview = { totalCount: 12, remainingCount: 2, installments: [installment(11, '2026-12-15', '104000'), installment(12, '2027-01-15', '102000')], totalInterest: '6000', totalToPay: '206000' };
    expect(purchaseSummary(old, TODAY)).toBe('Te faltan 2 de 12 cuotas. La próxima: $104.000 el 15 dic. La última: $102.000 el 15 ene 2027. Intereses por pagar: $6.000. Total por pagar: $206.000.');
    const lastOne: PurchasePreview = { ...old, remainingCount: 1, installments: [installment(12, '2026-12-15', '102000')] };
    expect(purchaseSummary(lastOne, TODAY)).toBe('Te falta 1 de 12 cuotas: $102.000 el 15 dic. Intereses por pagar: $6.000. Total por pagar: $206.000.');
    expect(purchaseSummary({ ...old, remainingCount: 0, installments: [], totalInterest: '0', totalToPay: '0' }, TODAY)).toBe('Ya tienes pagadas las 12 cuotas. No queda nada por pagar.');
  });
});

describe('validación del formulario de tarjeta', () => {
  const values = (over: Partial<CardFormValues> = {}): CardFormValues => ({ name: 'Visa', dueDayText: '15', paymentAccountId: 'bc', feeKind: 'NONE', feeAmountText: '', hasInterest: false, rateBasis: 'MV', rateText: '', ...over });
  const check = () => ({});

  it('errores con el texto exacto', () => {
    const r = validateCardForm(values({ name: ' ', dueDayText: '32', paymentAccountId: '', feeKind: 'ON_MOVEMENT', feeAmountText: '0', hasInterest: true, rateText: '0,00' }), check);
    expect(r).toEqual({
      ok: false,
      errors: {
        name: 'Escribe el nombre de la tarjeta.',
        dueDay: 'El día de pago va de 1 a 31.',
        account: 'Elige la cuenta desde la que pagas.',
        feeAmount: 'Escribe cuánto cobra de manejo.',
        rate: RATE_ZERO,
      },
    });
    expect(validateCardForm(values({ dueDayText: '0' }), check)).toMatchObject({ errors: { dueDay: 'El día de pago va de 1 a 31.' } });
    expect(validateCardForm(values({ dueDayText: '1,5' }), check)).toMatchObject({ errors: { dueDay: 'El día de pago va de 1 a 31.' } });
    expect(validateCardForm(values({ hasInterest: true, rateText: '' }), check)).toMatchObject({ errors: { rate: RATE_ZERO } });
  });

  it('muestra el error de la tasa que da la revisión', () => {
    expect(validateCardForm(values({ hasInterest: true, rateText: '11' }), () => ({ error: 'Muy alta' }))).toMatchObject({ errors: { rate: 'Muy alta' } });
  });

  it('solo envía el manejo y la tasa si aplican', () => {
    expect(validateCardForm(values({ feeAmountText: '5.000', rateText: '2' }), check)).toEqual({
      ok: true,
      value: { name: 'Visa', dueDay: 15, paymentAccountId: 'bc', feeKind: 'NONE' },
    });
    expect(validateCardForm(values({ feeKind: 'FIXED_MONTHLY', feeAmountText: '18.000', hasInterest: true, rateBasis: 'EA', rateText: '26,82' }), check)).toEqual({
      ok: true,
      value: { name: 'Visa', dueDay: 15, paymentAccountId: 'bc', feeKind: 'FIXED_MONTHLY', feeAmount: '18000', rateBasis: 'EA', rateText: '26,82' },
    });
  });
});

describe('validación del formulario de compra', () => {
  const values = (over: Partial<PurchaseFormValues> = {}): PurchaseFormValues => ({
    cardId: 'c1', description: 'Nevera', amountText: '1.200.000', installmentsChoice: '12', otherInstallmentsText: '', purchaseDate: '2026-11-02', firstDueDate: '2026-12-15', category: '', paidText: '', withoutInterest: false, ...over,
  });

  it('errores por campo', () => {
    const r = validatePurchaseForm(values({ cardId: '', description: '', amountText: '', installmentsChoice: 'Otro', otherInstallmentsText: '73', purchaseDate: '', firstDueDate: '' }));
    expect(r).toEqual({
      ok: false,
      errors: {
        card: 'Elige la tarjeta.',
        description: 'Escribe qué compraste.',
        amount: 'Escribe un monto mayor a cero.',
        installments: 'El número de cuotas va de 1 a 72.',
        purchaseDate: 'Elige la fecha de la compra.',
        firstDueDate: 'Elige la fecha de la primera cuota.',
      },
    });
    expect(validatePurchaseForm(values({ firstDueDate: '2026-10-01' }))).toMatchObject({ errors: { firstDueDate: 'La primera cuota no puede ser antes de la compra.' } });
    expect(validatePurchaseForm(values({ paidText: '13' }))).toMatchObject({ errors: { paid: 'Las cuotas ya pagadas no pueden ser más que el total de cuotas.' } });
  });

  it('arma la entrada con enteros y opcionales', () => {
    expect(validatePurchaseForm(values({ category: ' Hogar ', paidText: '3', withoutInterest: true }))).toEqual({
      ok: true,
      value: { cardId: 'c1', description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-11-02', firstDueDate: '2026-12-15', category: 'Hogar', paidInstallments: 3, withoutInterest: true },
    });
    expect(validatePurchaseForm(values({ installmentsChoice: 'Otro', otherInstallmentsText: '48' }))).toMatchObject({ value: { installments: 48 } });
  });
});

describe('CardForm', () => {
  const setup = (over: Partial<CardsApi> = {}, props: Partial<Parameters<typeof CardForm>[0]> = {}) => {
    const a = api(over);
    render(<CardForm accounts={accounts} checkRate={a.checkRate} onSubmit={a.createCard} onDone={vi.fn()} onCancel={vi.fn()} {...props} />);
    return a;
  };

  it('el monto y la tasa solo aparecen si aplican, con sus ayudas', async () => {
    setup();
    expect(screen.queryByLabelText('Monto')).toBeNull();
    expect(screen.queryByLabelText('Tasa')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Tipo de tasa' })).toBeNull();
    expect(screen.getByText('Algunos bancos cobran el manejo únicamente en los meses en que haces una compra. Elige esto si tu banco te lo cobra así.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Solo los meses que uso la tarjeta' }));
    expect(screen.getByLabelText('Monto')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Con intereses' }));
    expect(screen.getByRole('radio', { name: 'Mensual (M.V.)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Anual (E.A.)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tasa')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('Búscala en tu extracto. Si ves "M.V." es la tasa de cada mes; si ves "E.A." es la del año completo. Pon la que tengas y nosotros la convertimos.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ej: Visa Bancolombia')).toBe(screen.getByLabelText('Nombre'));
  });

  it('la advertencia de tasa no bloquea y envía los datos', async () => {
    const a = setup();
    await userEvent.type(screen.getByLabelText('Nombre'), 'Visa');
    await userEvent.type(screen.getByLabelText('Día en que pagas'), '15');
    await userEvent.click(screen.getByRole('radio', { name: 'Bancolombia' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Con intereses' }));
    await userEvent.type(screen.getByLabelText('Tasa'), '5');
    expect(await screen.findByText('Esa tasa parece muy alta. Revisa que no sea la anual puesta como mensual.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar tarjeta' }));
    expect(a.createCard).toHaveBeenCalledWith({ name: 'Visa', dueDay: 15, paymentAccountId: 'bc', feeKind: 'NONE', rateBasis: 'MV', rateText: '5' });
  });

  it('muestra los errores y no envía', async () => {
    const a = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar tarjeta' }));
    expect(await screen.findByText('Escribe el nombre de la tarjeta.')).toBeInTheDocument();
    expect(screen.getByText('El día de pago va de 1 a 31.')).toBeInTheDocument();
    expect(a.createCard).not.toHaveBeenCalled();
  });

  it('al editar viene precargada', () => {
    setup({}, { card: card({ rateBasis: 'EA', rateText: '26,82' }), onSubmit: vi.fn() });
    expect(screen.getByLabelText('Nombre')).toHaveValue('Visa Bancolombia');
    expect(screen.getByLabelText('Monto')).toHaveValue('18.000');
    expect(screen.getByLabelText('Tasa')).toHaveValue('26,82');
    expect(screen.getByRole('radio', { name: 'Anual (E.A.)' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('PurchaseForm', () => {
  const setup = (over: Partial<CardsApi> = {}, props: Partial<Parameters<typeof PurchaseForm>[0]> = {}) => {
    const a = api(over);
    const onDone = vi.fn();
    render(<PurchaseForm cards={[card()]} today={TODAY} api={a} initialCardId="c1" onDone={onDone} onCancel={vi.fn()} {...props} />);
    return { a, onDone };
  };
  async function fill() {
    await userEvent.type(screen.getByLabelText('Qué compraste'), 'Nevera');
    await userEvent.type(screen.getByLabelText('Monto'), '1200000');
    await userEvent.click(screen.getByRole('radio', { name: '12' }));
  }

  it('los campos vienen en orden y la primera cuota se sugiere', () => {
    setup();
    const labels = Array.from(document.querySelectorAll('form label, form [role=radiogroup]')).map((el) => el.getAttribute('aria-label') ?? el.textContent);
    expect(labels).toEqual(['Tarjeta', 'Qué compraste', 'Monto', 'Número de cuotas', 'Fecha de la compra', 'Primera cuota', 'Categoría (opcional)', 'Cuotas ya pagadas (opcional)', 'Esta compra me la dieron sin intereses']);
    expect(screen.getByLabelText('Primera cuota')).toHaveValue('2026-12-15');
  });

  it('el interruptor solo si la tarjeta cobra intereses, activado por defecto a 1 cuota', async () => {
    setup();
    const toggle = screen.getByRole('switch', { name: 'Esta compra me la dieron sin intereses' });
    expect(toggle).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: '12' }));
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('radio', { name: '6' }));
    expect(toggle).toBeChecked();
  });

  it('sin intereses en la tarjeta no aparece el interruptor', () => {
    setup({}, { cards: [card({ chargesInterest: false, monthlyRatePpm: 0 })] });
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('Otro pide el número', async () => {
    setup();
    expect(screen.queryByLabelText('¿Cuántas cuotas?')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Otro' }));
    expect(screen.getByLabelText('¿Cuántas cuotas?')).toBeInTheDocument();
  });

  it('confirma con cifras exactas, 3 cuotas, Ver las 12 y las notas; guarda una sola vez', async () => {
    const { a, onDone } = setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(a.addPurchase).not.toHaveBeenCalled();
    expect(screen.getByText('Vas a pagar 12 cuotas. La primera: $124.000 el 15 dic. La última: $102.000 el 15 nov 2027. Intereses en total: $156.000. Total a pagar: $1.356.000.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Ver las 12' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByText('La cuota baja cada mes porque los intereses se calculan sobre lo que aún debes.')).toBeInTheDocument();
    expect(screen.getByText('Es un estimado: tu banco puede calcular un poco distinto.')).toBeInTheDocument();
    await userEvent.dblClick(screen.getByRole('button', { name: 'Sí, guardar la compra' }));
    expect(a.addPurchase).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('sin intereses no muestra las notas de intereses', async () => {
    setup({ previewPurchase: vi.fn(() => ({ ok: true as const, preview: { ...preview12, totalInterest: '0', totalToPay: '1200000' } })) });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.queryByText(/La cuota baja cada mes/)).toBeNull();
    expect(screen.queryByText(/Es un estimado/)).toBeNull();
  });

  it('Corregir vuelve al formulario con lo escrito; el error de la vista previa se muestra', async () => {
    const { a } = setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Corregir' }));
    expect(screen.getByLabelText('Qué compraste')).toHaveValue('Nevera');
    expect(a.addPurchase).not.toHaveBeenCalled();
    vi.mocked(a.previewPurchase).mockReturnValueOnce({ ok: false, error: 'El monto es demasiado grande.' });
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('El monto es demasiado grande.');
  });

  it('con cuotas pagadas solo deja editar descripción y categoría', async () => {
    const { a } = setup({}, { purchase: purchase() });
    expect(screen.queryByLabelText('Monto')).toBeNull();
    expect(screen.queryByLabelText('Primera cuota')).toBeNull();
    expect(screen.getByText('Esta compra ya tiene cuotas pagadas: solo puedes cambiar la descripción y la categoría.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Qué compraste'));
    await userEvent.type(screen.getByLabelText('Qué compraste'), 'Nevera nueva');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(a.updatePurchase).toHaveBeenCalledWith('p1', {
      cardId: 'c1', description: 'Nevera nueva', amount: '1200000', installments: 12, purchaseDate: '2026-08-02', firstDueDate: '2026-09-15', category: 'Hogar', paidInstallments: 3, withoutInterest: false,
    });
    expect(a.previewPurchase).not.toHaveBeenCalled();
  });

  it('editar sin cuotas pagadas guarda sin pasar por la confirmación', async () => {
    const { a } = setup({}, { purchase: purchase({ paidInstallments: 0 }) });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(a.updatePurchase).toHaveBeenCalledOnce();
  });
});

describe('CardsScreen', () => {
  const setup = (cards: CardView[] = [card()], over: Partial<CardsApi> = {}, list: Account[] = accounts) => {
    const a = api(over);
    render(<CardsScreen cards={cards} accounts={list} today={TODAY} api={a} />);
    return a;
  };

  it('estado vacío', () => {
    setup([]);
    expect(screen.getByText('Aquí verás lo que debes en tus tarjetas de crédito. Empieza agregando una.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar tarjeta' })).toBeEnabled();
  });

  it('sin cuentas no deja agregar y explica por qué', () => {
    setup([], {}, []);
    expect(screen.getByRole('button', { name: 'Agregar tarjeta' })).toBeDisabled();
    expect(screen.getByText('Primero crea una cuenta desde la que pagarás la tarjeta.')).toBeInTheDocument();
  });

  it('avisa si hay una cuenta tipo tarjeta de crédito', () => {
    setup([card()], {}, [...accounts, { id: 'cr', name: 'Crédito', type: 'CREDIT', initialBalance: cop('0') }]);
    expect(screen.getByText('Tienes una cuenta tipo tarjeta de crédito. Si registras aquí esa misma tarjeta, no sumes su deuda dos veces.')).toBeInTheDocument();
  });

  it('una tarjeta muestra deuda, próxima cuota, compras y manejo', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Visa Bancolombia' })).toBeInTheDocument();
    expect(screen.getByText('Debes en total $900.000')).toBeInTheDocument();
    expect(screen.getByText('Próxima cuota $118.000 el 15 dic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar compra en Visa Bancolombia' })).toBeInTheDocument();
    expect(screen.getByText('3/12 cuotas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pagar cuota: Nevera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deshacer último pago: Nevera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Liquidar: Nevera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pagar manejo de noviembre' })).toBeInTheDocument();
  });

  it('una compra sin pagos no ofrece deshacer; una cerrada no ofrece pagar', () => {
    setup([card({ purchases: [purchase({ paidInstallments: 0 }), purchase({ id: 'p2', description: 'Sofá', closedOn: '2026-10-01', next: null, settle: null })] })]);
    expect(screen.queryByRole('button', { name: 'Deshacer último pago: Nevera' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pagar cuota: Sofá' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deshacer último pago: Sofá' })).toBeNull();
    expect(screen.getByText('Liquidada el 1 oct')).toBeInTheDocument();
  });

  it('pagar cuota: cuenta de la tarjeta, hoy, capital fijo e interés editable', async () => {
    const a = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Pagar cuota: Nevera' }));
    const panel = screen.getByRole('group', { name: 'Pagar cuota de Nevera' });
    expect(within(panel).getByRole('radio', { name: 'Nu' })).toHaveAttribute('aria-checked', 'true');
    expect(within(panel).getByLabelText('Fecha de pago')).toHaveValue(TODAY);
    expect(within(panel).getByText('$100.000')).toBeInTheDocument();
    const interest = within(panel).getByLabelText('Intereses de esta cuota');
    expect(interest).toHaveValue('18.000');
    expect(within(panel).getByText('Ajústalo si tu extracto dice otro valor.')).toBeInTheDocument();
    await userEvent.clear(interest);
    await userEvent.type(interest, '20000');
    expect(within(panel).getByText('Total: $120.000')).toBeInTheDocument();
    await userEvent.dblClick(within(panel).getByRole('button', { name: 'Confirmar pago' }));
    expect(a.payInstallment).toHaveBeenCalledOnce();
    expect(a.payInstallment).toHaveBeenCalledWith('p1', { fromAccountId: 'nu', paidOn: TODAY, interest: '20000', installment: 4 });
  });

  it('un interés vacío cuenta como 0', async () => {
    const a = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Pagar cuota: Nevera' }));
    await userEvent.clear(screen.getByLabelText('Intereses de esta cuota'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    expect(a.payInstallment).toHaveBeenCalledWith('p1', expect.objectContaining({ interest: '0' }));
  });

  it('un pago rechazado muestra el motivo y deja el panel abierto', async () => {
    setup([card()], { payInstallment: vi.fn().mockResolvedValue({ ok: false, error: 'Esa cuota todavía no es la siguiente. Revisa la lista.' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Pagar cuota: Nevera' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esa cuota todavía no es la siguiente. Revisa la lista.');
    expect(screen.getByRole('group', { name: 'Pagar cuota de Nevera' })).toBeInTheDocument();
  });

  it('liquidar confirma el total y avisa que no se puede deshacer', async () => {
    const a = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Liquidar: Nevera' }));
    const panel = screen.getByRole('group', { name: 'Liquidar Nevera' });
    expect(within(panel).getByText('Vas a pagar $918.000 y esta compra queda cerrada: $900.000 de lo que debes y $18.000 de intereses de la próxima cuota.')).toBeInTheDocument();
    expect(within(panel).getByText('Después de liquidar no se puede deshacer.')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Sí, liquidar' }));
    expect(a.settle).toHaveBeenCalledWith('p1', { fromAccountId: 'nu', paidOn: TODAY });
  });

  it('deshacer pide confirmación', async () => {
    const a = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer último pago: Nevera' }));
    expect(a.undoLastPayment).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, deshacer' }));
    expect(a.undoLastPayment).toHaveBeenCalledWith('p1', { installment: 3 });
  });

  it('pagar manejo permite ajustar el valor', async () => {
    const a = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Pagar manejo de noviembre' }));
    const value = screen.getByLabelText('Valor del manejo');
    expect(value).toHaveValue('18.000');
    await userEvent.clear(value);
    await userEvent.type(value, '19000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    expect(a.payFee).toHaveBeenCalledWith('c1', '2026-11', { fromAccountId: 'nu', paidOn: TODAY, amount: '19000' });
  });

  it('borrar la tarjeta avisa qué pasa con los pagos', async () => {
    const a = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar tarjeta Visa Bancolombia' }));
    expect(screen.getByText('Se borran la tarjeta y sus compras. Los pagos que ya hiciste se quedan en tu historial.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    expect(a.removeCard).toHaveBeenCalledWith('c1');
  });

  it('borrar una compra avisa qué pasa con los pagos', async () => {
    const a = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar compra Nevera' }));
    expect(screen.getByText('Se quita la deuda de esta compra. Los pagos que ya hiciste se quedan en tu historial.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    expect(a.removePurchase).toHaveBeenCalledWith('p1');
  });

  it('Agregar compra abre el formulario con esa tarjeta elegida y vuelve a la lista al cancelar', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar compra en Visa Bancolombia' }));
    expect(await screen.findByRole('radio', { name: 'Visa Bancolombia' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Debes en total $900.000')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Debes en total $900.000')).toBeInTheDocument();
  });
});
