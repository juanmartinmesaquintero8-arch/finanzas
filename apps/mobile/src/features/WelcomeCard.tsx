'use client';

import { ui, type ActionResult } from '@finanzas/ui';
import Link from 'next/link';
import { useState } from 'react';

/** Primer uso: bienvenida simple, con la opción de mirar la app con datos de ejemplo. */
export function WelcomeCard({ onLoadSample }: { onLoadSample: () => Promise<ActionResult> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadSample() {
    setBusy(true);
    setError(null);
    const result = await onLoadSample();
    if (!result.ok) setError(result.error);
    setBusy(false);
  }

  return (
    <section className={`${ui.card} ${ui.stack}`}>
      <h1 className={ui.pageTitle}>¡Bienvenido a Mis Finanzas!</h1>
      <p>Aquí llevas el control de tu plata: lo que tienes, lo que gastas y lo que te toca pagar.</p>
      <p>Todo se guarda solo en este celular. Nadie más puede verlo.</p>
      <Link href="/cuentas/nueva" className={ui.button}>
        Crea tu primera cuenta
      </Link>
      <button type="button" className={ui.buttonGhost} onClick={loadSample} disabled={busy}>
        Ver con datos de ejemplo
      </button>
      {error && (
        <p role="alert" className={ui.alert}>
          {error}
        </p>
      )}
    </section>
  );
}
