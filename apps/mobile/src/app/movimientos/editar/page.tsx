import { Suspense } from 'react';
import { EditTransactionScreen } from '@/features/EditScreens';

export const metadata = { title: 'Editar movimiento · Mis Finanzas' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <EditTransactionScreen />
    </Suspense>
  );
}
