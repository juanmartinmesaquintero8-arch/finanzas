import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './BottomNav.module.css';

export interface NavTab {
  href: string;
  label: string;
  icon: ReactNode;
  primary?: boolean;
}

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {path}
  </svg>
);

export const NAV_ICONS = {
  home: icon(<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />),
  history: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  add: icon(<path d="M12 5v14M5 12h14" />),
  scheduled: icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  settings: icon(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>),
} as const;

export const DEFAULT_TABS: NavTab[] = [
  { href: '/', label: 'Inicio', icon: NAV_ICONS.home },
  { href: '/historial', label: 'Historial', icon: NAV_ICONS.history },
  { href: '/agregar', label: 'Agregar', primary: true, icon: NAV_ICONS.add },
  { href: '/programados', label: 'Programados', icon: NAV_ICONS.scheduled },
];

interface Props {
  tabs: readonly NavTab[];
  /** Ruta actual (sin basePath); la app decide cómo obtenerla. */
  pathname: string;
}

const normalize = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** Barra inferior presentacional: las pestañas y la ruta activa llegan por props. */
export function BottomNav({ tabs, pathname }: Props) {
  const current = normalize(pathname);
  const isActive = (href: string) => (href === '/' ? current === '/' : current.startsWith(normalize(href)));
  return (
    <nav className={styles.nav} aria-label="Principal">
      <ul className={styles.list} style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((t) => (
          <li key={t.href} className={styles.item}>
            <Link
              href={t.href}
              className={`${styles.link} ${t.primary ? styles.primary : ''}`}
              aria-current={isActive(t.href) ? 'page' : undefined}
            >
              {t.icon}
              <span>{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
