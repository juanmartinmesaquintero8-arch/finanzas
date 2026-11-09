'use client';

import { useRef, useState } from 'react';
import type { ActionResult } from './action-result';

const FAILED = 'No pudimos guardar. Intenta de nuevo.';

/**
 * Ejecuta una acción de dinero una sola vez: mientras corre, y después si salió bien, ignora más toques.
 * Solo si falla se puede volver a intentar.
 */
export function useSubmit(onDone: () => void) {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: () => Promise<ActionResult>): Promise<void> {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    let failure: string | null = null;
    try {
      const result = await action();
      if (!result.ok) failure = result.error;
    } catch {
      failure = FAILED;
    }
    if (failure === null) {
      onDone();
      return;
    }
    running.current = false;
    setPending(false);
    setError(failure);
  }

  return { pending, error, setError, submit };
}
