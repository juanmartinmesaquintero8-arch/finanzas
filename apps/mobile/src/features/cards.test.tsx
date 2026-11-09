import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppServices } from '@/application/create-services';
import { makeServices, renderWithServices } from '@/test-utils';
import { HomeScreen } from './HomeScreen';
import { ScheduledPage } from './ScheduledPage';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(search),
}));

let services: AppServices;
let accountId = '';
beforeEach(async () => {
  search = 'tipo=tarjetas';
  services = await makeServices();
  await services.accounts.create({ name: 'Bancolombia', type: 'BANK', initialBalance: '5000000' });
  accountId = (await services.accounts.list())[0]!.id;
});

async function createCard(over = {}) {
  await services.cards.createCard({ name: 'Visa', dueDay: 15, paymentAccountId: accountId, feeKind: 'NONE', rateBasis: 'MV', rateText: '2', ...over });
  return (await services.cards.list())[0]!;
}

describe('Programados: Tarjetas', () => {
  it('el selector lleva a Tarjetas con ?tipo=tarjetas y muestra su estado vacío', async () => {
    await renderWithServices(<ScheduledPage />, services);
    const group = await screen.findByRole('group', { name: 'Tipo de programado' });
    expect(within(group).getByRole('link', { name: 'Tarjetas' })).toHaveAttribute('href', '/programados?tipo=tarjetas');
    expect(within(group).getByRole('link', { name: 'Tarjetas' })).toHaveAttribute('aria-current', 'true');
    expect(await screen.findByText('Aquí verás lo que debes en tus tarjetas de crédito. Empieza agregando una.')).toBeInTheDocument();
  });

  it('flujo completo: crea la tarjeta, agrega la compra con vista previa exacta y paga la cuota', async () => {
    await renderWithServices(<ScheduledPage />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar tarjeta' }));
    await userEvent.type(await screen.findByLabelText('Nombre'), 'Visa Bancolombia');
    await userEvent.type(screen.getByLabelText('Día en que pagas'), '15');
    await userEvent.click(screen.getByRole('radio', { name: 'Bancolombia' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Con intereses' }));
    await userEvent.type(screen.getByLabelText('Tasa'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar tarjeta' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Agregar compra en Visa Bancolombia' }));
    await userEvent.type(await screen.findByLabelText('Qué compraste'), 'Nevera');
    await userEvent.type(screen.getByLabelText('Monto'), '1200000');
    await userEvent.click(screen.getByRole('radio', { name: '12' }));
    expect(screen.getByLabelText('Primera cuota')).toHaveValue('2026-04-15');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Vas a pagar 12 cuotas. La primera: $124.000 el 15 abr. La última: $102.000 el 15 mar 2027. Intereses en total: $156.000. Total a pagar: $1.356.000.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, guardar la compra' }));

    expect(await screen.findByText('Debes en total $1.200.000')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pagar cuota: Nevera' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    expect(await screen.findByText('Debes en total $1.100.000')).toBeInTheDocument();
    expect(screen.getByText('1/12 cuotas')).toBeInTheDocument();
    expect((await services.transactions.page({})).items).toHaveLength(2);
    expect((await services.summary.projection('2026-03-31')).netWorth.amount).toBe('4876000');
  });

  it('manejo con movimiento: una compra nueva hace aparecer la cuota del mes siguiente en la pantalla', async () => {
    const card = await createCard({ feeKind: 'ON_MOVEMENT', feeAmount: '18000' });
    await renderWithServices(<ScheduledPage />, services);
    await screen.findByText('Debes en total $0');
    expect(screen.queryByRole('button', { name: /Pagar manejo/ })).toBeNull();
    await services.cards.addPurchase({ cardId: card.id, description: 'Libro', amount: '50000', installments: 1, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15', withoutInterest: true });
    expect(await screen.findByRole('button', { name: 'Pagar manejo de marzo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pagar manejo de marzo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Pagar manejo de marzo' })).toBeNull());
  });

  it('con una cuenta tipo crédito avisa para no contar doble', async () => {
    await services.accounts.create({ name: 'Tarjeta vieja', type: 'CREDIT', initialBalance: '0' });
    await renderWithServices(<ScheduledPage />, services);
    expect(await screen.findByText('Tienes una cuenta tipo tarjeta de crédito. Si registras aquí esa misma tarjeta, no sumes su deuda dos veces.')).toBeInTheDocument();
  });

  it('las otras pestañas siguen funcionando', async () => {
    search = '';
    await renderWithServices(<ScheduledPage />, services);
    expect(await screen.findByRole('button', { name: '+ Nuevo gasto programado' })).toBeInTheDocument();
  });
});

describe('Inicio con tarjetas', () => {
  it('muestra la deuda total, informativa: no se resta del Saldo Real', async () => {
    search = '';
    const card = await createCard();
    await services.cards.addPurchase({ cardId: card.id, description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15' });
    await renderWithServices(<HomeScreen />, services);
    expect(await screen.findByText('Deuda total en tarjetas')).toBeInTheDocument();
    expect(screen.getByText('$1.200.000')).toBeInTheDocument();
    const projection = await services.summary.projection('2026-03-31');
    expect(projection.availableBalance.amount).toBe('5000000');
  });

  it('sin tarjetas no la muestra', async () => {
    search = '';
    await renderWithServices(<HomeScreen />, services);
    await screen.findByRole('heading', { level: 1, name: 'Inicio' });
    expect(screen.queryByText('Deuda total en tarjetas')).toBeNull();
  });
});
