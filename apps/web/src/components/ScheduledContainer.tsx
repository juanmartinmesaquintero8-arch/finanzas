'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import {
  createScheduledExpenseAction,
  deleteScheduledExpenseAction,
  settleScheduledExpenseAction,
} from '@/app/actions';
import type { Account, ScheduledExpense } from '@/lib/types';
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
}

async function ensureOk(promise: Promise<{ ok: boolean; error?: string }>): Promise<void> {
  const res = await promise;
  if (!res.ok) throw new Error(res.error);
}

export function ScheduledContainer({ items, accounts, today }: Props) {
  const [creating, setCreating] = useState(false);
  return (
    <div className={ui.stack}>
      {creating ? (
        <ScheduledForm
          accounts={accounts}
          today={today}
          onSubmit={createScheduledExpenseAction}
          onDone={() => setCreating(false)}
        />
      ) : (
        <button type="button" className={ui.button} onClick={() => setCreating(true)} disabled={accounts.length === 0}>
          + Nuevo gasto programado
        </button>
      )}
      <ScheduledList
        items={items}
        accounts={accounts}
        today={today}
        onSettle={(id, through) => ensureOk(settleScheduledExpenseAction(id, through))}
        onDelete={(id) => ensureOk(deleteScheduledExpenseAction(id))}
      />
    </div>
  );
}
