'use client';

import { useState } from 'react';
import type { Account, TransactionPage } from '@/lib/types';
import { HistoryList } from './HistoryList';
import ui from './ui.module.css';

interface Props {
  initialPage: TransactionPage;
  accounts: Account[];
  accountId?: string;
  loadPage: (params: { accountId?: string; cursor: string }) => Promise<TransactionPage>;
  onDelete: (id: string) => Promise<void>;
}

/** Historial con paginación por cursor (keyset): "Cargar más" pide siempre `nextCursor`. */
export function HistoryView({ initialPage, accounts, accountId, loadPage, onDelete }: Props) {
  const [items, setItems] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await loadPage({ accountId, cursor: nextCursor });
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError('No pudimos cargar más movimientos. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    await onDelete(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className={ui.stack}>
      <HistoryList items={items} accounts={accounts} onDelete={remove} />
      {error && (
        <p role="alert" className={ui.alert}>
          {error}
        </p>
      )}
      {nextCursor && (
        <button type="button" className={ui.buttonGhost} onClick={loadMore} disabled={loading}>
          {loading ? 'Cargando…' : 'Cargar más'}
        </button>
      )}
    </div>
  );
}
