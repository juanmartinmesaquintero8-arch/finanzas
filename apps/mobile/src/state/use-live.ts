'use client';

import { useEffect, useRef, useState } from 'react';
import type { AppServices } from '@/application/create-services';
import { useServices } from './services-provider';

export interface LiveState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
}

/**
 * Lee datos con un servicio y los vuelve a leer solos cuando algo cambia (Observer sobre el ChangeBus).
 * `live: false` lee sólo al abrir o al cambiar `deps` (útil para listas con "cargar más").
 */
export function useLive<T>(load: (services: AppServices) => Promise<T>, deps: readonly unknown[] = [], options: { live?: boolean } = {}): LiveState<T> {
  const services = useServices();
  const live = options.live ?? true;
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState<LiveState<T>>({ data: undefined, error: null, loading: true });

  useEffect(() => {
    let active = true;
    let latest = 0;
    const run = () => {
      const id = ++latest;
      loadRef.current(services).then(
        (data) => active && id === latest && setState({ data, error: null, loading: false }),
        () => active && id === latest && setState((prev) => ({ ...prev, error: 'No pudimos leer tus datos. Intenta de nuevo.', loading: false })),
      );
    };
    setState((prev) => ({ ...prev, loading: true }));
    run();
    const off = live ? services.bus.subscribe(run) : undefined;
    return () => {
      active = false;
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, live, ...deps]);

  return state;
}
