import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppServices } from '@/application/create-services';
import { ServicesProvider } from './services-provider';

const BLOCKED = 'Cierra las otras ventanas de Mis Finanzas para terminar de actualizar la app. Tus datos están a salvo.';

describe('ServicesProvider', () => {
  it('muestra el aviso de bloqueo en vez de quedarse en "Cargando…" y vuelve cuando se libera', async () => {
    let release!: (s: AppServices) => void;
    let notify!: () => void;
    const load = (hooks?: { onBlocked?: () => void }) => {
      notify = () => hooks?.onBlocked?.();
      return new Promise<AppServices>((r) => (release = r));
    };
    render(
      <ServicesProvider loadServices={load}>
        <p>Listo</p>
      </ServicesProvider>,
    );
    expect(await screen.findByText('Cargando…')).toBeInTheDocument();
    notify();
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument();
    release({} as AppServices);
    expect(await screen.findByText('Listo')).toBeInTheDocument();
  });

  it('si la base no abre muestra un mensaje claro que aclara que no se borró nada', async () => {
    render(
      <ServicesProvider loadServices={() => Promise.reject(new Error('boom'))}>
        <p>Listo</p>
      </ServicesProvider>,
    );
    expect(await screen.findByText(/No pudimos abrir el almacenamiento de tu celular/)).toBeInTheDocument();
    expect(screen.getByText(/No se borró nada/)).toBeInTheDocument();
  });
});
