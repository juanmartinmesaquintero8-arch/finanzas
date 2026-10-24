'use client';

import { BottomNav, DEFAULT_TABS, NAV_ICONS, type NavTab } from '@finanzas/ui';
import { usePathname } from 'next/navigation';
import { routes } from './routes';

export const MOBILE_TABS: NavTab[] = [
  ...DEFAULT_TABS,
  { href: routes.settings, label: 'Ajustes', icon: NAV_ICONS.settings },
];

/** Barra inferior de la app móvil: las 4 pestañas de siempre más "Ajustes". */
export function AppNav() {
  return <BottomNav tabs={MOBILE_TABS} pathname={usePathname()} />;
}
