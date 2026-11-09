'use client';

import { ErrorCard, ui } from '@finanzas/ui';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createServices, type AppServices } from '@/application/create-services';
import { openFinanzasDb, type OpenHooks } from '@/data/database';
import { requestPersistentStorage } from '@/pwa/storage';

/** Tras este tiempo sin abrir la base se pide cerrar las otras ventanas. */
const SLOW_OPEN_MS = 5000;

const ServicesContext = createContext<AppServices | null>(null);

/** Abre la base del teléfono, pide que no la borren y arma los servicios. */
export async function loadRealServices(hooks?: OpenHooks): Promise<AppServices> {
  const db = await openFinanzasDb(undefined, hooks);
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
  loadServices?: (hooks?: OpenHooks) => Promise<AppServices>;
}) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Una pestaña congelada en segundo plano puede no avisar nunca el bloqueo: si tarda, se avisa igual.
    const slow = setTimeout(() => !cancelled && setBlocked(true), SLOW_OPEN_MS);
    loadServices({ onBlocked: () => !cancelled && setBlocked(true) }).then(
      (s) => {
        clearTimeout(slow);
        if (!cancelled) {
          setBlocked(false);
          setServices(s);
        }
      },
      () => {
        clearTimeout(slow);
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      clearTimeout(slow);
    };
  }, [loadServices]);

  if (failed) {
    return (
      <ErrorCard message="No pudimos abrir el almacenamiento de tu celular. No se borró nada: la app no tocó tus datos." />
    );
  }
  if (!services && blocked) {
    return (
      <p className={ui.empty} role="status">
        Cierra las otras ventanas de Mis Finanzas para terminar de actualizar la app. Tus datos están a salvo.
      </p>
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
