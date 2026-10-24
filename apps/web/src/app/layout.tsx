import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { BottomNav } from '@/components/BottomNav';
import './globals.css';
import styles from './layout.module.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Mis Finanzas',
  description: 'Controla tu dinero: cuentas, movimientos y gastos programados.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0b6b4f' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1512' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body>
        <main className={styles.main}>{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
