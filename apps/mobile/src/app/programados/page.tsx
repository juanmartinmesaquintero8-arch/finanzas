import { Suspense } from 'react';
import { ScheduledPage } from '@/features/ScheduledPage';

export const metadata = { title: 'Programados · Mis Finanzas' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ScheduledPage />
    </Suspense>
  );
}
