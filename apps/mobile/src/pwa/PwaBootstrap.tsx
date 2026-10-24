'use client';

import { useEffect } from 'react';
import { BASE_PATH } from './base-path';
import { registerServiceWorker } from './register-sw';

/** Registra el service worker al abrir la app (sólo en la versión publicada, no en desarrollo). */
export function PwaBootstrap() {
  useEffect(() => {
    void registerServiceWorker(navigator, BASE_PATH, process.env.NODE_ENV === 'production');
  }, []);
  return null;
}
