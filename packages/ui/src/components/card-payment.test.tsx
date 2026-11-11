import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CardsApi } from '../lib/cards';
import type { Account, CardPaymentInput, CardPaymentPreview, CardPaymentPreviewInput, CardView, PurchaseView } from '../lib/types';
import { CardsScreen } from './CardsScreen';

// Pantalla «Pagar tarjeta»: un pago por tarjeta, desglose antes de confirmar, la pregunta de la plata de más y deshacer.

const TODAY = '2026-11-08';
const cop = (amount: string) => ({ amount, currency: 'COP' });
const accounts: Account[] = [
  { id: 'bc', name: 'Bancolombia', type: 'BANK', initialBalance: cop('0') },
  { id: 'nu', name: 'Nu', type: 'DIGITAL', initialBalance: cop('0') },
];

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
  dueDayAnchor: 15,
  paidCount: 3,
  installmentCount: 12,
  next: { number: 4, dueDate: '2026-11-15', capital: '100000', interest: '18000', total: '118000' },
  settle: { capital: '900000', interest: '18000', total: '918000' },
  ...over,
});

const card = (over: Partial<CardView> = {}): CardView => ({
  id: 'c1',
  name: 'Visa Bancolombia',
  dueDay: 15,
  cutDay: 5,
  paymentAccountId: 'nu',
  feeKind: 'FIXED_MONTHLY',
  feeAmount: '18000',
  rateBasis: 'MV',
  rateText: '2',
  monthlyRatePpm: 20000,
  chargesInterest: true,
  debt: '900000',
  next: { amount: '118000', date: '2026-11-15' },
  purchases: [purchase()],
  pendingFees: [{ month: '2026-10', dueDate: '2026-11-15', amount: '18000' }],
  lastPaidFeeMonth: '2026-09',
  overdue: '0',
  lastCardPayment: null,
  ...over,
});

const preview = (over: Partial<CardPaymentPreview> = {}): CardPaymentPreview => ({
  total: '136000',
  max: '936000',
  fees: [{ month: '2026-10', amount: '18000' }],
  purchases: [{ purchaseId: 'p1', description: 'Nevera', interest: '18000', capital: '100000', extraCapital: '0', paidOff: false }],
  extraCapital: '0',
  needsMode: false,
  outcomes: [],
  pending: '0',
  dueSoon: null,
  extraPurchaseId: null,
  extraTargets: [],
  signature: 'firma-exacta',
  ...over,
});

/** Paga 336.000: lo del mes y 200.000 de más a la Nevera (la sugerida); con el Sofá elegido, a él. */
function extraPreview(input: CardPaymentPreviewInput): CardPaymentPreview {
  const toSofa = input.extraPurchaseId === 'p2';
  return preview({
    total: '336000',
    purchases: toSofa
      ? [
          { purchaseId: 'p1', description: 'Nevera', interest: '18000', capital: '100000', extraCapital: '0', paidOff: false },
          { purchaseId: 'p2', description: 'Sofá', interest: '0', capital: '0', extraCapital: '200000', paidOff: false },
        ]
      : [{ purchaseId: 'p1', description: 'Nevera', interest: '18000', capital: '100000', extraCapital: '200000', paidOff: false }],
    extraCapital: '200000',
    needsMode: true,
    outcomes: [
      toSofa
        ? { purchaseId: 'p2', SHORTEN: { remainingInstallments: 2, nextInstallment: '100000', endDate: '2027-01-15' }, LOWER: { remainingInstallments: 4, nextInstallment: '50000', endDate: '2027-03-15' } }
        : { purchaseId: 'p1', SHORTEN: { remainingInstallments: 6, nextInstallment: '118000', endDate: '2027-05-15' }, LOWER: { remainingInstallments: 8, nextInstallment: '91000', endDate: '2027-07-15' } },
    ],
    extraPurchaseId: toSofa ? 'p2' : 'p1',
    extraTargets: [
      { purchaseId: 'p1', description: 'Nevera' },
      { purchaseId: 'p2', description: 'Sofá' },
    ],
    signature: toSofa ? 'firma-sofa' : 'firma-nevera',
  });
}

function api(over: Partial<CardsApi> = {}): CardsApi {
  const ok = () => vi.fn().mockResolvedValue({ ok: true });
  const none = { lostCount: 0, lostAmount: '0', changedCount: 0 };
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
    undoLastFee: ok(),
    cardChangeImpact: vi.fn().mockResolvedValue(none),
    purchaseRemovalImpact: vi.fn().mockResolvedValue(none),
    purchaseChangeImpact: vi.fn().mockResolvedValue(none),
    checkRate: vi.fn(() => ({})),
    suggestFirstDueDate: vi.fn(() => '2026-12-15'),
    previewPurchase: vi.fn(() => ({ ok: false as const, error: 'no' })),
    paymentShortcuts: vi.fn().mockResolvedValue({ ok: true, thisMonth: '136000', max: '936000' }),
    previewCardPayment: vi.fn().mockResolvedValue({ ok: true, preview: preview() }),
    payCard: ok(),
    undoLastCardPayment: ok(),
    ...over,
  };
}

function setup(cards: CardView[] = [card()], over: Partial<CardsApi> = {}) {
  const a = api(over);
  render(<CardsScreen cards={cards} accounts={accounts} today={TODAY} api={a} />);
  return a;
}

async function openForm() {
  await userEvent.click(screen.getByRole('button', { name: 'Pagar tarjeta Visa Bancolombia' }));
  return screen.findByLabelText('¿Cuánto pagaste?');
}

async function review(amount: string) {
  const field = await openForm();
  await userEvent.type(field, amount);
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  return screen.findByRole('heading', { name: /^Así se reparte tu pago de/ });
}

/** Una línea del desglose (el nombre va en negrita, así que el texto está partido en dos elementos). */
const line = (text: string) => (_: string, el: Element | null) => el?.tagName === 'LI' && el.textContent === text;

const paidIds = (a: CardsApi) => vi.mocked(a.payCard).mock.calls.map(([, input]) => (input as CardPaymentInput).paymentId);

describe('la tarjeta en la lista', () => {
  it('sin pagos nuevos: «Pagar tarjeta» en lugar de los botones por compra y por manejo; siguen los deshacer de antes', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Pagar tarjeta Visa Bancolombia' })).toHaveTextContent('Pagar tarjeta');
    expect(screen.queryByRole('button', { name: /^Pagar cuota/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Liquidar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Pagar manejo/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Deshacer último pago: Nevera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deshacer último pago de manejo de Visa Bancolombia' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Deshacer último pago de la tarjeta/ })).toBeNull();
  });

  it('con pagos nuevos: solo «Deshacer último pago de la tarjeta»', () => {
    setup([card({ lastCardPayment: { id: 'pago-1', total: '324000', paidOn: '2026-11-05' } })]);
    expect(screen.queryByRole('button', { name: 'Deshacer último pago: Nevera' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Deshacer último pago de manejo/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Deshacer último pago de la tarjeta Visa Bancolombia' })).toHaveTextContent('Deshacer último pago de la tarjeta');
  });

  it('dice lo vencido con el estilo de advertencia; sin nada vencido no lo dice', () => {
    setup([card({ overdue: '124000' })]);
    expect(screen.getByText('Vencido $124.000')).toBeInTheDocument();
  });

  it('sin nada vencido no aparece «Vencido»', () => {
    setup();
    expect(screen.queryByText(/^Vencido/)).toBeNull();
  });

  it('la próxima cuota y las cuotas de cada compra salen del cálculo nuevo', () => {
    const partial = purchase({ paidCount: 1, installmentCount: 10, next: { number: 2, dueDate: '2026-11-15', capital: '74000', interest: '0', total: '74000' } });
    setup([card({ purchases: [partial], next: { amount: '74000', date: '2026-11-15' } })]);
    expect(screen.getByText('1/10 cuotas')).toBeInTheDocument();
    expect(screen.getByText('Próxima: $74.000 el 15 nov')).toBeInTheDocument();
    expect(screen.getByText('Próxima cuota $74.000 el 15 nov')).toBeInTheDocument();
  });

  it('sin deuda ni manejo no ofrece pagar', () => {
    setup([card({ debt: '0', purchases: [], pendingFees: [], next: null })]);
    expect(screen.queryByRole('button', { name: /^Pagar tarjeta/ })).toBeNull();
  });
});

describe('formulario «Pagar tarjeta»', () => {
  it('atajos con los montos exactos, la cuenta de pago de la tarjeta y hoy', async () => {
    const a = setup([card()], { paymentShortcuts: vi.fn().mockResolvedValue({ ok: true, thisMonth: '246000', max: '1224000' }) });
    const amount = await openForm();
    expect(a.paymentShortcuts).toHaveBeenCalledWith('c1', TODAY);
    await userEvent.click(await screen.findByRole('button', { name: /^Lo de este mes/ }));
    expect(amount).toHaveValue('246.000');
    await userEvent.click(screen.getByRole('button', { name: /^Todo/ }));
    expect(amount).toHaveValue('1.224.000');
    expect(within(screen.getByRole('radiogroup', { name: 'Se pagó desde' })).getByRole('radio', { name: 'Nu' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Fecha del pago')).toHaveValue(TODAY);
  });

  it('cambiar la fecha recalcula los atajos a ese día', async () => {
    const a = setup();
    await openForm();
    const date = screen.getByLabelText('Fecha del pago');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-11-01');
    await vi.waitFor(() => expect(a.paymentShortcuts).toHaveBeenLastCalledWith('c1', '2026-11-01'));
  });

  it('valida con los mensajes del servicio y no avanza', async () => {
    const previewCardPayment = vi.fn().mockResolvedValue({ ok: false, error: 'El pago debe ser mayor que cero.' });
    setup([card()], { previewCardPayment });
    await openForm();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(previewCardPayment).toHaveBeenCalledWith('c1', { amount: '0', paidOn: TODAY, fromAccountId: 'nu' });
    expect(await screen.findByRole('alert')).toHaveTextContent('El pago debe ser mayor que cero.');
    expect(screen.getByLabelText('¿Cuánto pagaste?')).toBeInTheDocument();
  });

  it('el máximo y la fecha también los dice el servicio', async () => {
    setup([card()], { previewCardPayment: vi.fn().mockResolvedValue({ ok: false, error: 'La fecha del pago no puede ser anterior al último pago de esta tarjeta.' }) });
    await openForm();
    await userEvent.type(screen.getByLabelText('¿Cuánto pagaste?'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La fecha del pago no puede ser anterior al último pago de esta tarjeta.');
  });

  it('sin cuenta elegida lo pide antes de calcular', async () => {
    const a = setup([card({ paymentAccountId: 'borrada' })]);
    await openForm();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Elige la cuenta y la fecha del pago.');
    expect(a.previewCardPayment).not.toHaveBeenCalled();
  });

  it('el paymentId no cambia en un doble toque ni al reintentar, y sí después de un pago exitoso', async () => {
    let finish: (v: { ok: true }) => void = () => undefined;
    const payCard = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'No pudimos guardar. Intenta de nuevo.' })
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue({ ok: true });
    const a = setup([card()], { payCard });
    await review('136000');
    await userEvent.click(screen.getByRole('button', { name: 'Sí, registrar el pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar. Intenta de nuevo.');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Sí, registrar el pago' }));
    finish({ ok: true });
    expect(await screen.findByText('Pago registrado.')).toBeInTheDocument();
    expect(payCard).toHaveBeenCalledTimes(2);
    const [first, retry] = paidIds(a);
    expect(first).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(retry).toBe(first);

    await review('136000');
    await userEvent.click(screen.getByRole('button', { name: 'Sí, registrar el pago' }));
    await screen.findByText('Pago registrado.');
    expect(paidIds(a)[2]).not.toBe(first);
  });

  it('cancelar vuelve a la lista sin pagar', async () => {
    const a = setup();
    await openForm();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Pagar tarjeta Visa Bancolombia' })).toBeInTheDocument();
    expect(a.payCard).not.toHaveBeenCalled();
  });
});

describe('desglose antes de confirmar', () => {
  it('pago exacto: el reparto por manejo y por compra, sin pregunta', async () => {
    setup();
    expect(await review('136000')).toHaveTextContent('Así se reparte tu pago de $136.000');
    expect(screen.getByText(line('Manejo octubre 2026: $18.000'))).toBeInTheDocument();
    expect(screen.getByText(line('Nevera: $100.000 de capital y $18.000 de intereses'))).toBeInTheDocument();
    expect(screen.queryByText(/^Te sobran/)).toBeNull();
    expect(screen.queryByText(/^Queda pendiente/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Corregir' })).toBeInTheDocument();
  });

  it('pago parcial: dice cuánto queda pendiente y qué pasa', async () => {
    setup([card()], { previewCardPayment: vi.fn().mockResolvedValue({ ok: true, preview: preview({ total: '100000', fees: [], pending: '24000' }) }) });
    await review('100000');
    expect(screen.getByText('Queda pendiente $24.000. Lo que falte sigue vencido y el interés del próximo mes sube un poco.')).toBeInTheDocument();
  });

  it('plata de más: la pregunta con los valores de las dos opciones y la compra sugerida', async () => {
    setup([card()], { previewCardPayment: vi.fn(async (_id: string, input: CardPaymentPreviewInput) => ({ ok: true as const, preview: extraPreview(input) })) });
    await review('336000');
    expect(screen.getByText(line('Nevera: $300.000 de capital y $18.000 de intereses'))).toBeInTheDocument();
    const question = screen.getByRole('radiogroup', { name: 'Te sobran $200.000. ¿Qué quieres hacer con esa plata?' });
    const shorten = within(question).getByRole('radio', { name: 'Terminar antes' });
    expect(shorten).toBeChecked();
    expect(shorten).toHaveAccessibleDescription('Pagas las mismas cuotas, pero terminas en mayo de 2027. Te ahorras más intereses.');
    const lower = within(question).getByRole('radio', { name: 'Bajar la cuota' });
    expect(lower).not.toBeChecked();
    expect(lower).toHaveAccessibleDescription('Terminas en la misma fecha y la próxima cuota baja a $91.000.');
    const target = screen.getByRole('radiogroup', { name: '¿A qué compra va la plata de más?' });
    expect(within(target).getByRole('radio', { name: 'Nevera' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Te sugerimos la de mayor interés.')).toBeInTheDocument();
  });

  it('el selector cambia el destino y el desglose', async () => {
    const previewCardPayment = vi.fn(async (_id: string, input: CardPaymentPreviewInput) => ({ ok: true as const, preview: extraPreview(input) }));
    setup([card()], { previewCardPayment });
    await review('336000');
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '¿A qué compra va la plata de más?' })).getByRole('radio', { name: 'Sofá' }));
    expect(previewCardPayment).toHaveBeenLastCalledWith('c1', { amount: '336000', paidOn: TODAY, fromAccountId: 'nu', extraPurchaseId: 'p2' });
    expect(await screen.findByText(line('Sofá: $200.000 de capital y $0 de intereses'))).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Terminar antes' })).toHaveAccessibleDescription('Pagas las mismas cuotas, pero terminas en enero de 2027. Te ahorras más intereses.');
  });

  it('lo confirmado es exactamente lo mostrado: mismo monto, fecha, cuenta, destino, opción y la firma del desglose', async () => {
    const previewCardPayment = vi.fn(async (_id: string, input: CardPaymentPreviewInput) => ({ ok: true as const, preview: extraPreview(input) }));
    const a = setup([card()], { previewCardPayment });
    await review('336000');
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '¿A qué compra va la plata de más?' })).getByRole('radio', { name: 'Sofá' }));
    await screen.findByText(line('Sofá: $200.000 de capital y $0 de intereses'));
    await userEvent.click(screen.getByRole('radio', { name: 'Bajar la cuota' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, registrar el pago' }));
    expect(a.payCard).toHaveBeenCalledWith('c1', {
      amount: '336000',
      paidOn: TODAY,
      fromAccountId: 'nu',
      extraPurchaseId: 'p2',
      mode: 'LOWER',
      paymentId: expect.any(String),
      expected: 'firma-sofa',
    });
  });

  it('sin plata de más se confirma sin opción ni destino', async () => {
    const a = setup();
    await review('136000');
    await userEvent.click(screen.getByRole('button', { name: 'Sí, registrar el pago' }));
    expect(a.payCard).toHaveBeenCalledWith('c1', { amount: '136000', paidOn: TODAY, fromAccountId: 'nu', paymentId: expect.any(String), expected: 'firma-exacta' });
  });

  it('«Corregir» vuelve al formulario con lo escrito', async () => {
    setup();
    await review('136000');
    await userEvent.click(screen.getByRole('button', { name: 'Corregir' }));
    expect(screen.getByLabelText('¿Cuánto pagaste?')).toHaveValue('136.000');
  });
});

describe('deshacer el último pago de la tarjeta', () => {
  it('pide confirmación con el valor y la fecha, y deshace ese pago', async () => {
    const a = setup([card({ lastCardPayment: { id: 'pago-1', total: '324000', paidOn: '2026-11-05' } })]);
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer último pago de la tarjeta Visa Bancolombia' }));
    expect(screen.getByText('Se borra el pago de $324.000 del 5 nov y su dinero vuelve a la cuenta. Las cuotas que cubrió vuelven a quedar pendientes.')).toBeInTheDocument();
    expect(a.undoLastCardPayment).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, deshacer' }));
    expect(a.undoLastCardPayment).toHaveBeenCalledWith('c1', { paymentId: 'pago-1' });
  });

  it('«Volver» cierra la confirmación sin deshacer', async () => {
    const a = setup([card({ lastCardPayment: { id: 'pago-1', total: '324000', paidOn: '2026-11-05' } })]);
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer último pago de la tarjeta Visa Bancolombia' }));
    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(a.undoLastCardPayment).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Deshacer último pago de la tarjeta Visa Bancolombia' })).toBeInTheDocument();
  });
});
