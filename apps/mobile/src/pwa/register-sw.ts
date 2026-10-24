interface ServiceWorkerHost {
  serviceWorker?: Pick<ServiceWorkerContainer, 'register'>;
}

/**
 * Registra el service worker (lo que permite abrir la app sin internet).
 * `enabled` es falso en desarrollo para no cachear código a medio escribir.
 */
export async function registerServiceWorker(host: ServiceWorkerHost, basePath: string, enabled: boolean): Promise<boolean> {
  if (!enabled || !host.serviceWorker) return false;
  try {
    await host.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath}/` });
    return true;
  } catch {
    return false;
  }
}
