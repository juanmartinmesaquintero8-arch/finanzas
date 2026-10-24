import { Suspense } from 'react';
import { NewAccountScreen } from '@/features/NewAccountScreen';

export const metadata = { title: 'Nueva cuenta · Mis Finanzas' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NewAccountScreen />
    </Suspense>
  );
}
