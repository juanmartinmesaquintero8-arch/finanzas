import { Suspense } from 'react';
import { HistoryScreen } from '@/features/HistoryScreen';

export const metadata = { title: 'Historial · Mis Finanzas' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HistoryScreen />
    </Suspense>
  );
}
