import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { feeImpactText, type CardsApi } from '../lib/cards';
import { formatMonthLong } from '../lib/format';
import type { Account, CardView, FeeImpact, PurchasePreview, PurchaseView, Transaction } from '../lib/types';
import { CardForm } from './CardForm';
import { CardsScreen } from './CardsScreen';
import { HistoryList } from './HistoryList';
import { PurchaseForm } from './PurchaseForm';

const TODAY = '2026-11-08';
const cop = (amount: string) => ({ amount, currency: 'COP' });
const accounts: Account[] = [{ id: 'bc', name: 'Bancolombia', type: 'BANK', initialBalance: cop('0') }];
const none: FeeImpact = { lostCount: 0, lostAmount: '0', changedCount: 0 };
const lost2: FeeImpact = { lostCount: 2, lostAmount: '36000', changedCount: 0 };
const LOST = 'Dejarás de ver 2 cuotas de manejo por $36.000.';

const inst = (number: number, dueDate: string, total = '118000') => ({ number, dueDate, capital: '100000', interest: '18000', total });
const preview: PurchasePreview = { totalCount: 2, remainingCount: 2, installments: [inst(1, '2026-12-15'), inst(2, '2027-01-15')], totalInterest: '36000', totalToPay: '236000' };

const purchase = (over: Partial<PurchaseView> = {}): PurchaseView => ({
  id: 'p1', cardId: 'c1', description: 'Nevera', category: 'Hogar', amount: '1200000', installments: 12, paidInstallments: 0, purchaseDate: '2026-08-02', firstDueDate: '2026-09-15',
  monthlyRatePpm: 20000, closedOn: null, dueDayAnchor: 15, next: inst(1, '2026-12-15'), settle: { capital: '1200000', interest: '24000', total: '1224000' }, ...over,
});
const card = (over: Partial<CardView> = {}): CardView => ({
  id: 'c1', name: 'Visa', dueDay: 15, paymentAccountId: 'bc', feeKind: 'FIXED_MONTHLY', feeAmount: '18000', rateBasis: 'MV', rateText: '2', monthlyRatePpm: 20000, chargesInterest: true, debt: '900000',
  next: { amount: '118000', date: '2026-12-15' }, purchases: [purchase()], pendingFees: [{ month: '2026-11', dueDate: '2026-12-15', amount: '18000' }], lastPaidFeeMonth: null, ...over,
});

function api(over: Partial<CardsApi> = {}): CardsApi {
  const ok = () => vi.fn().mockResolvedValue({ ok: true });
  return {
    createCard: ok(), updateCard: ok(), removeCard: ok(), addPurchase: ok(), updatePurchase: ok(), removePurchase: ok(), payInstallment: ok(), undoLastPayment: ok(), settle: ok(), payFee: ok(), undoLastFee: ok(),
    checkRate: vi.fn(() => ({})),
    suggestFirstDueDate: vi.fn(() => '2026-12-15'),
    previewPurchase: vi.fn(() => ({ ok: true as const, preview })),
    cardChangeImpact: vi.fn().mockResolvedValue(none),
    purchaseRemovalImpact: vi.fn().mockResolvedValue(none),
    purchaseChangeImpact: vi.fn().mockResolvedValue(none),
    ...over,
  };
}

describe('textos', () => {
  it('feeImpactText', () => {
    expect(feeImpactText(none)).toBeNull();
    expect(feeImpactText(lost2)).toBe(LOST);
    expect(feeImpactText({ lostCount: 1, lostAmount: '18000', changedCount: 0 })).toBe('Dejarás de ver 1 cuota de manejo por $18.000.');
    expect(feeImpactText({ lostCount: 0, lostAmount: '0', changedCount: 2 })).toBe('Cambiará el valor de 2 cuotas de manejo sin pagar.');
    expect(feeImpactText({ lostCount: 0, lostAmount: '0', changedCount: 1 })).toBe('Cambiará el valor de 1 cuota de manejo sin pagar.');
    expect(feeImpactText({ lostCount: 1, lostAmount: '5', changedCount: 2 })).toBe('Dejarás de ver 1 cuota de manejo por $5. Cambiará el valor de 2 cuotas de manejo sin pagar.');
  });
  it('M3: mes en palabras', () => expect(formatMonthLong('2026-11')).toBe('noviembre 2026'));
});

describe('HistoryList con pagos de tarjeta', () => {
  const tx: Transaction = { id: 'cp-p-1', type: 'EXPENSE', amount: cop('1'), date: '2026-03-10', description: 'Nevera (cuota 1/12)', category: 'Hogar', accountId: 'bc', fromAccountId: null, toAccountId: null };
  it('sin borrar: etiqueta y mensaje; no hay enlace ni botón', () => {
    render(<HistoryList items={[{ ...tx, cardPayment: { message: 'Motivo', canDelete: false } }]} accounts={accounts} onDelete={vi.fn()} now={new Date('2026-03-10T15:00:00Z')} />);
    expect(screen.getByText('Pago de tarjeta')).toBeInTheDocument();
    expect(screen.getByText('Motivo')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('huérfano: solo eliminar y sin motivo', () => {
    render(<HistoryList items={[{ ...tx, cardPayment: { message: 'Motivo', canDelete: true } }]} accounts={accounts} onDelete={vi.fn()} now={new Date('2026-03-10T15:00:00Z')} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Motivo')).toBeNull();
    expect(screen.getByRole('button', { name: 'Eliminar Nevera (cuota 1/12)' })).toBeInTheDocument();
  });
});

describe('I3, I5, M3, M4 en la lista', () => {
  const setup = (c: CardView, over: Partial<CardsApi> = {}) => {
    const a = api(over);
    render(<CardsScreen cards={[c]} accounts={accounts} today={TODAY} api={a} />);
    return a;
  };

  it('deshacer pago de manejo: solo si hay uno, con confirmación y el mes visto', async () => {
    const a = setup(card({ lastPaidFeeMonth: '2026-10', pendingFees: [] }));
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer último pago de manejo de Visa' }));
    expect(a.undoLastFee).not.toHaveBeenCalled();
    expect(screen.getByText('Esta cuota de manejo vuelve a quedar pendiente y el dinero vuelve a la cuenta.')).toBeInTheDocument();
    await userEvent.dblClick(screen.getByRole('button', { name: 'Sí, deshacer' }));
    expect(a.undoLastFee).toHaveBeenCalledOnce();
    expect(a.undoLastFee).toHaveBeenCalledWith('c1', { month: '2026-10' });
  });

  it('sin manejo pagado no se ofrece', () => {
    setup(card());
    expect(screen.queryByRole('button', { name: /Deshacer último pago de manejo/ })).toBeNull();
  });

  it('I5: el texto de deshacer cuota', async () => {
    setup(card({ purchases: [purchase({ paidInstallments: 2 })] }));
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer último pago: Nevera' }));
    expect(screen.getByText('Esta cuota vuelve a quedar pendiente. Si la pagaste desde la app, el dinero vuelve a la cuenta; si la habías marcado como ya pagada, ningún saldo cambia.')).toBeInTheDocument();
  });

  it('M3: la fila del manejo dice el mes en palabras', () => {
    setup(card());
    expect(screen.getByText('Manejo Visa (noviembre 2026)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pagar manejo de noviembre 2026' })).toBeInTheDocument();
  });

  it('M4: una cuota vencida lo dice; la que vence hoy no', () => {
    setup(card({ next: { amount: '118000', date: '2026-10-05' }, purchases: [purchase({ next: inst(1, '2026-10-05') }), purchase({ id: 'p2', description: 'Hoy', next: inst(1, TODAY) })] }));
    const nodes = screen.getAllByText('Vencida el 5 oct: $118.000');
    expect(nodes).toHaveLength(2);
    expect(screen.getByText('Próxima: $118.000 el 8 nov')).toBeInTheDocument();
  });

  it('I6: borrar una compra avisa lo que se pierde y espera el cálculo', async () => {
    let finish: (v: FeeImpact) => void = () => undefined;
    const a = setup(card(), { purchaseRemovalImpact: vi.fn(() => new Promise<FeeImpact>((r) => (finish = r))) });
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar compra Nevera' }));
    expect(screen.getByRole('button', { name: 'Sí, eliminar' })).toBeDisabled();
    finish(lost2);
    expect(await screen.findByText(LOST)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    expect(a.removePurchase).toHaveBeenCalledWith('p1');
  });

  it('I6: el aviso después de guardar una compra se muestra en la lista', async () => {
    const notice = 'Esa compra es de un mes con manejo ya pagado, así que no se generó una cuota nueva.';
    setup(card(), { addPurchase: vi.fn().mockResolvedValue({ ok: true, notice }) });
    await userEvent.click(screen.getByRole('button', { name: 'Agregar compra en Visa' }));
    await userEvent.type(await screen.findByLabelText('Qué compraste'), 'Libro');
    await userEvent.type(screen.getByLabelText('Monto'), '50000');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, guardar la compra' }));
    expect(await screen.findByRole('status')).toHaveTextContent(notice);
  });
});

describe('I6: editar la tarjeta', () => {
  const setup = (impact: FeeImpact) => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const checkImpact = vi.fn().mockResolvedValue(impact);
    render(<CardForm card={card()} accounts={accounts} checkRate={() => ({})} checkImpact={checkImpact} onSubmit={onSubmit} onDone={vi.fn()} onCancel={vi.fn()} />);
    return { onSubmit, checkImpact };
  };

  it('si se pierden cuotas pide confirmar; Volver no guarda', async () => {
    const { onSubmit } = setup(lost2);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText(LOST)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByLabelText('Nombre')).toHaveValue('Visa');
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, guardar' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('sin impacto guarda directo', async () => {
    const { onSubmit } = setup(none);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });
});

describe('I7: editar una compra', () => {
  const setup = (over: Partial<CardsApi> = {}, p = purchase()) => {
    const a = api(over);
    render(<PurchaseForm cards={[card(), card({ id: 'c2', name: 'Otra' })]} today={TODAY} api={a} purchase={p} onDone={vi.fn()} onCancel={vi.fn()} />);
    return a;
  };

  it('no ofrece cambiar de tarjeta', () => {
    setup();
    expect(screen.queryByRole('radiogroup', { name: 'Tarjeta' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Otra' })).toBeNull();
  });

  it('cambiar solo descripción o categoría guarda directo', async () => {
    const a = setup();
    await userEvent.type(screen.getByLabelText('Qué compraste'), ' grande');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(a.updatePurchase).toHaveBeenCalledOnce());
    expect(a.previewPurchase).not.toHaveBeenCalled();
  });

  it('cambiar el monto muestra el resumen con la compra propia y guarda al confirmar', async () => {
    const a = setup();
    await userEvent.clear(screen.getByLabelText('Monto'));
    await userEvent.type(screen.getByLabelText('Monto'), '600000');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText(/^Vas a pagar 2 cuotas/)).toBeInTheDocument();
    expect(a.previewPurchase).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), expect.objectContaining({ amount: '600000' }), expect.objectContaining({ id: 'p1', monthlyRatePpm: 20000 }));
    expect(a.updatePurchase).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, guardar la compra' }));
    expect(a.updatePurchase).toHaveBeenCalledOnce();
  });

  it('cambiar la fecha también confirma, avisando las cuotas de manejo que se pierden', async () => {
    const a = setup({ purchaseChangeImpact: vi.fn().mockResolvedValue(lost2) });
    await userEvent.clear(screen.getByLabelText('Fecha de la compra'));
    await userEvent.type(screen.getByLabelText('Fecha de la compra'), '2026-07-02');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const section = await screen.findByRole('region', { name: 'Confirmar compra' });
    expect(within(section).getByText(LOST)).toBeInTheDocument();
    expect(a.updatePurchase).not.toHaveBeenCalled();
  });

  it('cambiar el número de cuotas confirma', async () => {
    const a = setup();
    await userEvent.click(screen.getByRole('radio', { name: '6' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText(/^Vas a pagar/);
    expect(a.updatePurchase).not.toHaveBeenCalled();
  });
});
