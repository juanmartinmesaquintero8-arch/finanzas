'use client';

import { deleteTransactionAction, loadTransactionsAction } from '@/app/actions';
import { HistoryView, type Account, type TransactionPage } from '@finanzas/ui';

interface Props {
  initialPage: TransactionPage;
  accounts: Account[];
  accountId?: string;
}

/** Conecta el historial con las Server Actions (cursor y borrado). */
export function HistoryContainer({ initialPage, accounts, accountId }: Props) {
  return (
    <HistoryView
      initialPage={initialPage}
      accounts={accounts}
      accountId={accountId}
      loadPage={loadTransactionsAction}
      onDelete={async (id) => {
        const res = await deleteTransactionAction(id);
        if (!res.ok) throw new Error(res.error);
      }}
    />
  );
}
