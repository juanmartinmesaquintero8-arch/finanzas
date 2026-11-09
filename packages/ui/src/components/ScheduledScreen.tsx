'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { ActionResult } from '../lib/action-result';
import { SCHEDULED_COPY, type ScheduledKind } from '../lib/scheduled-copy';
import type { Account, CreateScheduledExpenseInput, ScheduledExpense } from '../lib/types';
import { ScheduledList } from './ScheduledList';
import ui from './ui.module.css';

// Carga diferida: el formulario sólo se descarga cuando el usuario lo abre.
const ScheduledForm = dynamic(() => import('./ScheduledForm').then((m) => m.ScheduledForm), {
  loading: () => <p className={ui.empty}>Cargando…</p>,
});

interface Props {
  items: ScheduledExpense[];
  accounts: Account[];
  today: string;
  onCreate: (input: CreateScheduledExpenseInput) => Promise<ActionResult>;
  onUpdate: (id: string, input: CreateScheduledExpenseInput) => Promise<ActionResult>;
  onSettle: (id: string, through: string) => Promise<ActionResult>;
  onDelete: (id: string) => Promise<ActionResult>;
  /** Gastos (por defecto) o ingresos programados: la misma pantalla con otros textos. */
  kind?: ScheduledKind;
  /** Pide la categoría opcional en el formulario. */
  withCategory?: boolean;
}

async function ensureOk(promise: Promise<ActionResult>): Promise<void> {
  const res = await promise;
  if (!res.ok) throw new Error(res.error);
}

/** Pantalla de gastos o ingresos programados: sólo presentación, las acciones llegan por props. */
export function ScheduledScreen({ items, accounts, today, onCreate, onUpdate, onSettle, onDelete, kind = 'expense', withCategory = false }: Props) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ScheduledExpense | null>(null);
  return (
    <div className={ui.stack}>
      {editing ? (
        <ScheduledForm
          key={editing.id}
          accounts={accounts}
          today={today}
          expense={editing}
          kind={kind}
          withCategory={withCategory}
          onSubmit={(input) => onUpdate(editing.id, input)}
          onDone={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      ) : creating ? (
        <ScheduledForm
          accounts={accounts}
          today={today}
          kind={kind}
          withCategory={withCategory}
          onSubmit={onCreate}
          onDone={() => setCreating(false)}
        />
      ) : (
        <button type="button" className={ui.button} onClick={() => setCreating(true)} disabled={accounts.length === 0}>
          {SCHEDULED_COPY[kind].newButton}
        </button>
      )}
      <ScheduledList
        kind={kind}
        items={items}
        accounts={accounts}
        today={today}
        onSettle={(id, through) => ensureOk(onSettle(id, through))}
        onDelete={(id) => ensureOk(onDelete(id))}
        onEdit={(item) => {
          setCreating(false);
          setEditing(item);
        }}
      />
    </div>
  );
}
