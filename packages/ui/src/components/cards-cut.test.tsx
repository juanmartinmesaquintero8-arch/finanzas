import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { feeImpactText, validateCardForm, type CardFormValues, type CardsApi } from '../lib/cards';
import type { Account, CardView, FeeImpact } from '../lib/types';
import { CardForm } from './CardForm';
import { CardsScreen } from './CardsScreen';
import { PurchaseForm } from './PurchaseForm';

const TODAY = '2026-11-08';
const cop = (amount: string) => ({ amount, currency: 'COP' });
const accounts: Account[] = [{ id: 'bc', name: 'Bancolombia', type: 'BANK', initialBalance: cop('0') }];
const NONE: FeeImpact = { lostCount: 0, lostAmount: '0', changedCount: 0 };

const card = (over: Partial<CardView> = {}): CardView => ({
  id: 'c1',
  name: 'Visa',
  dueDay: 15,
  cutDay: 5,
  paymentAccountId: 'bc',
  feeKind: 'NONE',
  feeAmount: null,
  rateBasis: null,
  rateText: null,
  monthlyRatePpm: 0,
  chargesInterest: false,
  debt: '0',
  next: null,
  purchases: [],
  pendingFees: [],
  lastPaidFeeMonth: null,
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
    undoLastFee: ok(),
    cardChangeImpact: vi.fn().mockResolvedValue(NONE),
    purchaseRemovalImpact: vi.fn().mockResolvedValue(NONE),
    purchaseChangeImpact: vi.fn().mockResolvedValue(NONE),
    checkRate: vi.fn(() => ({})),
    suggestFirstDueDate: vi.fn(() => '2026-12-15'),
    previewPurchase: vi.fn(),
    ...over,
  };
}

describe('validación del día de corte', () => {
  const values = (over: Partial<CardFormValues> = {}): CardFormValues => ({
    name: 'Visa', dueDayText: '15', cutDayText: '5', cutRequired: true, paymentAccountId: 'bc', feeKind: 'NONE', feeAmountText: '', hasInterest: false, rateBasis: 'MV', rateText: '', ...over,
  });
  const check = () => ({});

  it('en una tarjeta nueva se pide', () => {
    expect(validateCardForm(values({ cutDayText: '' }), check)).toEqual({ ok: false, errors: { cutDay: 'Escribe el día de corte.' } });
  });

  it('al editar una tarjeta vieja puede quedar vacío y no se envía', () => {
    expect(validateCardForm(values({ cutDayText: '', cutRequired: false }), check)).toEqual({
      ok: true,
      value: { name: 'Visa', dueDay: 15, paymentAccountId: 'bc', feeKind: 'NONE' },
    });
  });

  it('va de 1 a 31, enteros', () => {
    for (const cutDayText of ['0', '32', '1,5', 'ab']) {
      expect(validateCardForm(values({ cutDayText }), check)).toMatchObject({ errors: { cutDay: 'El día de corte va de 1 a 31.' } });
    }
    expect(validateCardForm(values({ cutDayText: '31' }), check)).toMatchObject({ ok: true, value: { cutDay: 31 } });
  });

  it('no puede ser el día de pago', () => {
    expect(validateCardForm(values({ cutDayText: '15' }), check)).toMatchObject({ errors: { cutDay: 'El día de corte no puede ser el mismo día de pago.' } });
  });

  it('envía el corte junto al resto', () => {
    expect(validateCardForm(values(), check)).toEqual({ ok: true, value: { name: 'Visa', dueDay: 15, cutDay: 5, paymentAccountId: 'bc', feeKind: 'NONE' } });
  });
});

describe('CardForm: día de corte', () => {
  const setup = (props: Partial<Parameters<typeof CardForm>[0]> = {}) => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<CardForm accounts={accounts} checkRate={() => ({})} onSubmit={onSubmit} onDone={vi.fn()} onCancel={vi.fn()} {...props} />);
    return { onSubmit };
  };

  it('el campo va justo después de "Día en que pagas", con su ayuda', () => {
    setup();
    const labels = Array.from(document.querySelectorAll('form label')).map((el) => el.textContent);
    expect(labels.slice(0, 3)).toEqual(['Nombre', 'Día en que pagas', 'Día de corte']);
    expect(screen.getByText('Es el día en que el banco cierra tu extracto. Lo encuentras en el extracto como "fecha de corte".')).toBeInTheDocument();
  });

  it('en una tarjeta nueva lo pide', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText('Nombre'), 'Visa');
    await userEvent.type(screen.getByLabelText('Día en que pagas'), '15');
    await userEvent.click(screen.getByRole('radio', { name: 'Bancolombia' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar tarjeta' }));
    expect(await screen.findByText('Escribe el día de corte.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Día de corte'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar tarjeta' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Visa', dueDay: 15, cutDay: 5, paymentAccountId: 'bc', feeKind: 'NONE' });
  });

  it('al editar una tarjeta sin corte no lo exige', async () => {
    const { onSubmit } = setup({ card: card({ cutDay: null }) });
    expect(screen.getByLabelText('Día de corte')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Visa', dueDay: 15, paymentAccountId: 'bc', feeKind: 'NONE' });
  });

  it('al editar viene precargado y un cambio pasa por el aviso de manejo', async () => {
    const checkImpact = vi.fn().mockResolvedValue({ lostCount: 0, lostAmount: '0', changedCount: 2 });
    const { onSubmit } = setup({ card: card(), checkImpact });
    expect(screen.getByLabelText('Día de corte')).toHaveValue('5');
    await userEvent.clear(screen.getByLabelText('Día de corte'));
    await userEvent.type(screen.getByLabelText('Día de corte'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(checkImpact).toHaveBeenCalledWith({ name: 'Visa', dueDay: 15, cutDay: 20, paymentAccountId: 'bc', feeKind: 'NONE' });
    expect(await screen.findByText('Cambiará el valor de 2 cuotas de manejo sin pagar.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('CardsScreen: tarjeta sin día de corte', () => {
  const NOTICE = 'Agrega el día de corte para que las fechas de tus cuotas salgan exactas.';

  it('avisa y el enlace abre la edición de esa tarjeta', async () => {
    render(<CardsScreen cards={[card({ cutDay: null })]} accounts={accounts} today={TODAY} api={api()} />);
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar día de corte a Visa' }));
    expect(screen.getByLabelText('Día de corte')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
  });

  it('no avisa si la tarjeta ya tiene corte', () => {
    render(<CardsScreen cards={[card({ cutDay: 5 })]} accounts={accounts} today={TODAY} api={api()} />);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});

describe('PurchaseForm: primera cuota con corte', () => {
  it('pide la sugerencia con el corte de la tarjeta', () => {
    const a = api();
    render(<PurchaseForm cards={[card({ cutDay: 5 })]} today={TODAY} api={a} initialCardId="c1" onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(a.suggestFirstDueDate).toHaveBeenCalledWith(expect.objectContaining({ dueDay: 15, cutDay: 5 }), TODAY);
  });
});

describe('CardForm: filtra el día de corte y confirma quitarlo', () => {
  const setup = (props: Partial<Parameters<typeof CardForm>[0]> = {}) => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<CardForm accounts={accounts} checkRate={() => ({})} onSubmit={onSubmit} onDone={vi.fn()} onCancel={vi.fn()} {...props} />);
    return { onSubmit };
  };

  it('solo deja dígitos', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Día de corte'), 'a5');
    expect(screen.getByLabelText('Día de corte')).toHaveValue('5');
  });

  it('al vaciar el corte de una tarjeta que lo tenía pide confirmar', async () => {
    const { onSubmit } = setup({ card: card({ cutDay: 5 }) });
    await userEvent.clear(screen.getByLabelText('Día de corte'));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Vas a quitar el día de corte. Las próximas cuotas se calcularán solo con el día de pago.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByLabelText('Día de corte')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, quitarlo' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Visa', dueDay: 15, paymentAccountId: 'bc', feeKind: 'NONE' });
  });

  it('una tarjeta que nunca tuvo corte se guarda sin preguntar', async () => {
    const { onSubmit } = setup({ card: card({ cutDay: null }) });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).toHaveBeenCalled();
  });
});

describe('feeImpactText: fechas movidas y cuotas nuevas', () => {
  const base: FeeImpact = { lostCount: 0, lostAmount: '0', changedCount: 0 };
  it('con sus singulares', () => {
    expect(feeImpactText({ ...base, movedCount: 2 })).toBe('Cambiará la fecha de 2 cuotas de manejo sin pagar.');
    expect(feeImpactText({ ...base, movedCount: 1 })).toBe('Cambiará la fecha de 1 cuota de manejo sin pagar.');
    expect(feeImpactText({ ...base, newCount: 2, newAmount: '36000' })).toBe('Aparecerán 2 cuotas de manejo nuevas por $36.000.');
    expect(feeImpactText({ ...base, newCount: 1, newAmount: '18000' })).toBe('Aparecerá 1 cuota de manejo nueva por $18.000.');
    expect(feeImpactText({ lostCount: 1, lostAmount: '5', changedCount: 0, movedCount: 1, newCount: 1, newAmount: '7' })).toBe(
      'Dejarás de ver 1 cuota de manejo por $5. Cambiará la fecha de 1 cuota de manejo sin pagar. Aparecerá 1 cuota de manejo nueva por $7.',
    );
  });
});
