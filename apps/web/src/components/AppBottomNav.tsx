'use client';

import { BottomNav, DEFAULT_TABS } from '@finanzas/ui';
import { usePathname } from 'next/navigation';

/** Barra inferior de la web: conecta la ruta actual de Next con la barra compartida. */
export function AppBottomNav() {
  return <BottomNav tabs={DEFAULT_TABS} pathname={usePathname()} />;
}
