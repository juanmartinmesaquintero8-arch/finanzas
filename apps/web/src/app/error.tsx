'use client';

import { ui } from '@finanzas/ui';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className={`${ui.card} ${ui.stack}`}>
      <h2>Algo salió mal</h2>
      <p>No pudimos mostrar esta pantalla. Intenta de nuevo.</p>
      <button type="button" className={ui.button} onClick={reset}>
        Reintentar
      </button>
    </div>
  );
}
