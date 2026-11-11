import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppServices } from '@/application/create-services';
import { makeServices, renderWithServices } from '@/test-utils';
import { ScheduledPage } from './ScheduledPage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/programados',
  useSearchParams: () => new URLSearchParams('tipo=tarjetas'),
}));

// «Pagar tarjeta» con los servicios reales: pago parcial con algo vencido, pago con plata de más y deshacer.
// Hoy es 20 de abril en Colombia: la cuota 1 de la Nevera (100.000 + 24.000, el 15 de abril) está vencida.

let services: AppServices;
beforeEach(async () => {
  services = await makeServices(new Date('2026-04-20T17:00:00Z'));
  await services.accounts.create({ name: 'Bancolombia', type: 'BANK', initialBalance: '5000000' });
  const accountId = (await services.accounts.list())[0]!.id;
  await services.cards.createCard({ name: 'Visa', dueDay: 15, paymentAccountId: accountId, feeKind: 'NONE', rateBasis: 'MV', rateText: '2' });
  const cardId = (await services.cards.list())[0]!.id;
  await services.cards.addPurchase({ cardId, description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15', category: 'Hogar' });
});

const amounts = async () => (await services.transactions.page({})).items.map((t) => [t.description, t.amount.amount]);

async function pay(amount: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Pagar tarjeta Visa' }));
  await userEvent.type(await screen.findByLabelText('¿Cuánto pagaste?'), amount);
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('heading', { name: /^Así se reparte tu pago de/ });
}

describe('Pagar tarjeta de punta a punta', () => {
  it('pago parcial, pago con plata de más y deshacer', async () => {
    await renderWithServices(<ScheduledPage />, services);
    expect(await screen.findByText('Vencido $124.000')).toBeInTheDocument();

    // 1) Parcial: cubre primero el interés vencido y luego parte del capital; lo que falta sigue vencido.
    await userEvent.click(await screen.findByRole('button', { name: 'Pagar tarjeta Visa' }));
    expect(await screen.findByRole('button', { name: 'Lo de este mes $246.000' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('¿Cuánto pagaste?'), '100000');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('heading', { name: 'Así se reparte tu pago de $100.000' })).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'LI' && el.textContent === 'Nevera: $76.000 de capital y $24.000 de intereses')).toBeInTheDocument();
    expect(screen.getByText('Queda pendiente $24.000. Lo que falte sigue vencido y el interés del próximo mes sube un poco.')).toBeInTheDocument();
    expect(screen.queryByText(/^Te sobran/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, registrar el pago' }));
    expect(await screen.findByText('Pago registrado.')).toBeInTheDocument();
    expect(await screen.findByText('Vencido $24.000')).toBeInTheDocument();
    // Lo guardado es lo que se mostró.
    expect(await amounts()).toEqual(
      expect.arrayContaining([
        ['Nevera (pago de tarjeta)', '76000'],
        ['Intereses Nevera', '24000'],
      ]),
    );
    expect(screen.queryByRole('button', { name: 'Deshacer último pago: Nevera' })).toBeNull();

    // 2) Plata de más: se pregunta y por defecto termina antes.
    await pay('500000');
    expect(screen.getByRole('radiogroup', { name: /^Te sobran \$\d{1,3}(\.\d{3})*\. ¿Qué quieres hacer con esa plata\?$/ })).toBeInTheDocument();
    const shorten = screen.getByRole('radio', { name: 'Terminar antes' });
    expect(shorten).toBeChecked();
    expect(shorten).toHaveAccessibleDescription(/^Pagas las mismas cuotas, pero terminas en [a-z]+ de \d{4}\. Te ahorras más intereses\.$/);
    expect(screen.getByRole('radio', { name: 'Bajar la cuota' })).toHaveAccessibleDescription(/^Terminas en la misma fecha y la próxima cuota baja a \$[\d.]+\.$/);
    await userEvent.click(screen.getByRole('button', { name: 'Sí, registrar el pago' }));
    expect(await screen.findByText('Pago registrado.')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByText(/^Vencido/)).toBeNull());
    const debtAfter = (await services.cards.debtSummary()).debt;
    expect(BigInt(debtAfter)).toBeLessThan(1_124_000n);

    // 3) Deshacer el último: vuelve lo que había antes de ese pago.
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer último pago de la tarjeta Visa' }));
    const confirm = screen.getByRole('group', { name: 'Deshacer último pago de la tarjeta Visa' });
    expect(within(confirm).getByText('Se borra el pago de $500.000 del 20 abr y su dinero vuelve a la cuenta. Las cuotas que cubrió vuelven a quedar pendientes.')).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Sí, deshacer' }));
    expect(await screen.findByText('Vencido $24.000')).toBeInTheDocument();
    expect((await services.cards.debtSummary()).debt).toBe('1124000');
    expect(await amounts()).toHaveLength(2);
  });
});
