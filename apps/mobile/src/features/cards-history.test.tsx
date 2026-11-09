import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppServices } from '@/application/create-services';
import { makeServices, renderWithServices } from '@/test-utils';
import { EditTransactionScreen } from './EditScreens';
import { HistoryScreen } from './HistoryScreen';
import { SettingsScreen } from './SettingsScreen';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(search),
}));

let services: AppServices;
let accountId = '';
beforeEach(async () => {
  search = '';
  services = await makeServices();
  await services.accounts.create({ name: 'Banco', type: 'BANK', initialBalance: '5000000' });
  accountId = (await services.accounts.list())[0]!.id;
});

async function card(over = {}) {
  await services.cards.createCard({ name: 'Visa', dueDay: 15, paymentAccountId: accountId, feeKind: 'NONE', rateBasis: 'MV', rateText: '2', ...over });
  return (await services.cards.list())[0]!;
}
async function purchase(cardId: string) {
  await services.cards.addPurchase({ cardId, description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15', category: 'Hogar' });
  return (await services.cards.list())[0]!.purchases[0]!;
}
const payment = () => ({ fromAccountId: accountId, paidOn: '2026-03-10' });

const LABEL = 'Pago de tarjeta';

describe('Historial: pagos de tarjeta', () => {
  it('cuota de compra abierta: etiqueta, mensaje y sin editar ni eliminar', async () => {
    const c = await card();
    const p = await purchase(c.id);
    await services.cards.payInstallment(p.id, payment());
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findAllByText(LABEL)).toHaveLength(2);
    expect(screen.getAllByText('Este pago viene de una tarjeta. Para deshacerlo, usa «Deshacer último pago» en la tarjeta.')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /^Editar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Eliminar/ })).toBeNull();
  });

  it('pago de liquidación', async () => {
    const c = await card();
    const p = await purchase(c.id);
    await services.cards.settle(p.id, payment());
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findAllByText('Este pago liquidó una compra y no se puede deshacer.')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^Eliminar/ })).toBeNull();
  });

  it('manejo de una tarjeta que existe', async () => {
    const c = await card({ feeKind: 'FIXED_MONTHLY', feeAmount: '18000' });
    await services.cards.payFee(c.id, '2026-03', payment());
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByText('Para deshacer este pago, usa «Deshacer último pago de manejo» en la tarjeta.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Eliminar/ })).toBeNull();
  });

  it('si la compra ya no existe: solo eliminar, con confirmación', async () => {
    const c = await card();
    const p = await purchase(c.id);
    await services.cards.payInstallment(p.id, payment());
    await services.cards.removePurchase(p.id);
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findAllByText(LABEL)).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /^Editar/ })).toBeNull();
    expect(screen.queryByText(/Para deshacerlo/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Nevera (cuota 1/12)' }));
    expect(screen.getByText('¿Eliminar este movimiento?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    await waitFor(() => expect(screen.queryByText('Nevera (cuota 1/12)')).toBeNull());
    expect((await services.transactions.page({})).items).toHaveLength(1);
  });

  it('un movimiento normal conserva editar y eliminar, sin etiqueta', async () => {
    await services.transactions.create({ type: 'EXPENSE', amount: '100', date: '2026-03-10', description: 'Café', accountId });
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByRole('link', { name: 'Editar Café' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar Café' })).toBeInTheDocument();
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('entrar a editar por la dirección muestra el motivo, no el formulario', async () => {
    const c = await card();
    const p = await purchase(c.id);
    await services.cards.payInstallment(p.id, payment());
    search = `id=cp-${p.id}-1`;
    await renderWithServices(<EditTransactionScreen />, services);
    expect(await screen.findByText('Este pago viene de una tarjeta. Para deshacerlo, usa «Deshacer último pago» en la tarjeta.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
  });
});

describe('I4: Empezar de cero', () => {
  it('nombra todo lo que se borra en los dos textos', async () => {
    await renderWithServices(<SettingsScreen deliver={vi.fn()} />, services);
    const section = await screen.findByRole('region', { name: 'Empezar de cero' });
    expect(within(section).getByText('Borra todas tus cuentas, movimientos, gastos programados, ingresos programados, tarjetas y compras de este celular.')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Borrar todos mis datos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, continuar' }));
    expect(screen.getByText('Esto no se puede deshacer. Se borrarán todas tus cuentas, movimientos, gastos programados, ingresos programados, tarjetas y compras.')).toBeInTheDocument();
  });
});
