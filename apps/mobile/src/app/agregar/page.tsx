import { Suspense } from 'react';
import { AddScreen } from '@/features/AddScreen';

export const metadata = { title: 'Agregar · Mis Finanzas' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AddScreen />
    </Suspense>
  );
}
