import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppServices } from '@/application/create-services';
import { makeServices, renderWithServices } from '@/test-utils';
import { SettingsScreen } from './SettingsScreen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/ajustes/', useSearchParams: () => new URLSearchParams() }));

let services: AppServices;
beforeEach(async () => {
  services = await makeServices();
});

async function seed() {
  await services.accounts.create({ name: 'Bancolombia', type: 'BANK', initialBalance: '1000' });
  const [a] = await services.accounts.list();
  await services.transactions.create({ type: 'EXPENSE', amount: '10', date: '2026-03-09', description: 'Café', accountId: a!.id });
}

const fileOf = (content: string, name = 'copia.json') => new File([content], name, { type: 'application/json' });

describe('Ajustes: pantalla', () => {
  it('ofrece las tres acciones con textos simples', async () => {
    await renderWithServices(<SettingsScreen deliver={vi.fn()} />, services);
    expect(await screen.findByRole('heading', { name: 'Ajustes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hacer copia de seguridad' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recuperar copia')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Borrar todos mis datos' })).toBeInTheDocument();
    expect(screen.getByText(/todavía no has hecho una copia/i)).toBeInTheDocument();
    expect(screen.getByText(/solo están guardados en este celular/i)).toBeInTheDocument();
  });
});

describe('Ajustes: hacer copia de seguridad', () => {
  it('entrega el archivo, avisa que quedó lista y recuerda la fecha', async () => {
    await seed();
    const deliver = vi.fn().mockResolvedValue('shared');
    await renderWithServices(<SettingsScreen deliver={deliver} />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Hacer copia de seguridad' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/tu copia está lista/i);
    const delivered = deliver.mock.calls[0]![0] as { text: string; fileName: string };
    expect(JSON.parse(delivered.text)).toMatchObject({ version: 1, accounts: [{ name: 'Bancolombia' }] });
    expect(delivered.fileName).toBe('mis-finanzas-2026-03-10.json');
    expect(await services.backup.lastBackupAt()).not.toBeNull();
    expect(await screen.findByText(/última copia/i)).toBeInTheDocument();
  });

  it('si se descarga en vez de compartir, lo explica', async () => {
    await seed();
    await renderWithServices(<SettingsScreen deliver={vi.fn().mockResolvedValue('downloaded')} />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Hacer copia de seguridad' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/descargas/i);
  });

  it('si la persona cancela, no se marca como hecha', async () => {
    await seed();
    await renderWithServices(<SettingsScreen deliver={vi.fn().mockResolvedValue('cancelled')} />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Hacer copia de seguridad' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/no se envió/i);
    expect(await services.backup.lastBackupAt()).toBeNull();
  });

  it('si algo falla, muestra un error simple', async () => {
    await seed();
    await renderWithServices(<SettingsScreen deliver={vi.fn().mockRejectedValue(new Error('x'))} />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Hacer copia de seguridad' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos/i);
  });
});

describe('Ajustes: recuperar copia', () => {
  async function backupText() {
    await seed();
    return (await services.backup.create()).text;
  }

  it('muestra un resumen y pide confirmación antes de reemplazar', async () => {
    const text = await backupText();
    await services.accounts.create({ name: 'Extra', type: 'CASH', initialBalance: '0' });
    await renderWithServices(<SettingsScreen deliver={vi.fn()} />, services);
    await userEvent.upload(await screen.findByLabelText('Recuperar copia'), fileOf(text));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/1 cuenta/);
    expect(dialog).toHaveTextContent(/1 movimiento/);
    expect(dialog).toHaveTextContent(/reemplaza/i);
    // Todavía no cambió nada.
    expect((await services.accounts.list()).map((a) => a.name)).toContain('Extra');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Sí, recuperar' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/recuperamos tu copia/i);
    expect((await services.accounts.list()).map((a) => a.name)).toEqual(['Bancolombia']);
  });

  it('cancelar deja todo como estaba', async () => {
    const text = await backupText();
    await services.accounts.create({ name: 'Extra', type: 'CASH', initialBalance: '0' });
    await renderWithServices(<SettingsScreen deliver={vi.fn()} />, services);
    await userEvent.upload(await screen.findByLabelText('Recuperar copia'), fileOf(text));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect((await services.accounts.list()).map((a) => a.name)).toContain('Extra');
  });

  it('rechaza un archivo que no es una copia y no toca los datos', async () => {
    await seed();
    await renderWithServices(<SettingsScreen deliver={vi.fn()} />, services);
    await userEvent.upload(await screen.findByLabelText('Recuperar copia'), fileOf('esto no es json'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no parece una copia de seguridad/i);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await services.accounts.list()).toHaveLength(1);
  });
});

describe('Ajustes: borrar todos mis datos (doble confirmación)', () => {
  it('pide dos confirmaciones y recién ahí borra', async () => {
    await seed();
    await renderWithServices(<SettingsScreen deliver={vi.fn()} />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Borrar todos mis datos' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/seguro/i);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sí, continuar' }));
    expect(await services.data.hasData()).toBe(true);

    dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/última pregunta/i);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sí, borrar todo' }));
    await waitFor(async () => expect(await services.data.hasData()).toBe(false));
    expect(await screen.findByRole('status')).toHaveTextContent(/borramos/i);
  });

  it('se puede arrepentir en cualquiera de los dos pasos', async () => {
    await seed();
    await renderWithServices(<SettingsScreen deliver={vi.fn()} />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Borrar todos mis datos' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'No, volver' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Borrar todos mis datos' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sí, continuar' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'No, volver' }));
    expect(await services.data.hasData()).toBe(true);
  });
});

describe('Ajustes: datos de ejemplo', () => {
  it('ofrece borrar los ejemplos sólo cuando hay ejemplos', async () => {
    await renderWithServices(<SettingsScreen deliver={vi.fn()} />, services);
    await screen.findByRole('heading', { name: 'Ajustes' });
    expect(screen.queryByRole('button', { name: 'Borrar datos de ejemplo' })).not.toBeInTheDocument();
  });

  it('borra los ejemplos y deja lo propio', async () => {
    await services.data.loadSample();
    await renderWithServices(<SettingsScreen deliver={vi.fn()} />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Borrar datos de ejemplo' }));
    await waitFor(async () => expect(await services.data.hasSample()).toBe(false));
    expect(await services.accounts.list()).toEqual([]);
  });
});
