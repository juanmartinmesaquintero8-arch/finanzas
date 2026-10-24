'use client';

import { ui } from '@finanzas/ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' | string }>;
}

interface InstallState {
  canInstall: boolean;
  install: () => Promise<void>;
}

const InstallContext = createContext<InstallState>({ canInstall: false, install: async () => undefined });

/**
 * Guarda el aviso de instalación de Chrome (Android) para mostrarlo cuando la persona quiera.
 * Va en el layout porque el navegador lo dispara una sola vez y puede ser antes de abrir Ajustes.
 */
export function InstallProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null); // el aviso sólo se puede usar una vez
  }, [deferred]);

  const value = useMemo(() => ({ canInstall: deferred !== null, install }), [deferred, install]);
  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}

export const useInstall = () => useContext(InstallContext);

/** Tarjeta "Instalar en mi celular": sólo aparece cuando Chrome permite instalar. */
export function InstallPrompt() {
  const { canInstall, install } = useInstall();
  if (!canInstall) return null;
  return (
    <section className={`${ui.card} ${ui.stack}`} aria-label="Instalar la app">
      <p>Instala la app en tu celular para abrirla como cualquier otra y usarla sin internet.</p>
      <button type="button" className={ui.button} onClick={install}>
        Instalar en mi celular
      </button>
    </section>
  );
}
