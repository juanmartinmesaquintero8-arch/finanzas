'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import styles from './BottomNav.module.css';

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {path}
  </svg>
);

const TABS: { href: string; label: string; icon: ReactNode; primary?: boolean }[] = [
  { href: '/', label: 'Inicio', icon: icon(<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />) },
  { href: '/historial', label: 'Historial', icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>) },
  { href: '/agregar', label: 'Agregar', primary: true, icon: icon(<path d="M12 5v14M5 12h14" />) },
  { href: '/programados', label: 'Programados', icon: icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>) },
];

export function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  return (
    <nav className={styles.nav} aria-label="Principal">
      <ul className={styles.list}>
        {TABS.map((t) => (
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
