import { Suspense } from 'react';
import { SettingsScreen } from '@/features/SettingsScreen';

export const metadata = { title: 'Ajustes · Mis Finanzas' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SettingsScreen />
    </Suspense>
  );
}
