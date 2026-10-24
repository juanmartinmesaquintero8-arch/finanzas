import { Suspense } from 'react';
import { EditAccountScreen } from '@/features/EditScreens';

export const metadata = { title: 'Editar cuenta · Mis Finanzas' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <EditAccountScreen />
    </Suspense>
  );
}
