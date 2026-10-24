'use client';

import { ErrorCard, ui } from '@finanzas/ui';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createServices, type AppServices } from '@/application/create-services';
import { openFinanzasDb } from '@/data/database';
import { requestPersistentStorage } from '@/pwa/storage';

const ServicesContext = createContext<AppServices | null>(null);

/** Abre la base del teléfono, pide que no la borren y arma los servicios. */
export async function loadRealServices(): Promise<AppServices> {
  const db = await openFinanzasDb();
  void requestPersistentStorage(typeof navigator === 'undefined' ? undefined : navigator.storage);
  return createServices({ db });
}

/**
 * Entrega los servicios a las pantallas cuando la base ya está abierta.
 * Al compilar (exportación estática) sólo se dibuja el estado "cargando"; los datos se leen en el teléfono.
 */
export function ServicesProvider({
  children,
  loadServices = loadRealServices,
}: {
  children: ReactNode;
  loadServices?: () => Promise<AppServices>;
}) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadServices().then(
      (s) => !cancelled && setServices(s),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [loadServices]);

  if (failed) {
    return (
      <ErrorCard message="No pudimos abrir el almacenamiento de tu celular. Si estás en una ventana privada, abre la app en una normal." />
    );
  }
  if (!services) {
    return (
      <p className={ui.empty} role="status">
        Cargando…
      </p>
    );
  }
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices debe usarse dentro de <ServicesProvider>');
  return services;
}
