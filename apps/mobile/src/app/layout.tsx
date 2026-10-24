import { PageContainer } from '@finanzas/ui';
import '@finanzas/ui/src/globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppNav } from '@/features/AppNav';
import { BASE_PATH } from '@/pwa/base-path';
import { InstallProvider } from '@/pwa/install';
import { PwaBootstrap } from '@/pwa/PwaBootstrap';
import { ServicesProvider } from '@/state/services-provider';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Mis Finanzas',
  description: 'Controla tu dinero: cuentas, movimientos y gastos programados. Tus datos quedan solo en tu celular.',
  applicationName: 'Mis Finanzas',
  appleWebApp: { capable: true, title: 'Finanzas', statusBarStyle: 'default' },
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
      <head>
        <link rel="manifest" href={`${BASE_PATH}/manifest.webmanifest`} />
        <link rel="icon" type="image/png" sizes="192x192" href={`${BASE_PATH}/icons/icon-192.png`} />
        <link rel="apple-touch-icon" href={`${BASE_PATH}/icons/icon-192.png`} />
      </head>
      <body>
        <InstallProvider>
          <PageContainer>
            <ServicesProvider>{children}</ServicesProvider>
          </PageContainer>
          <AppNav />
        </InstallProvider>
        <PwaBootstrap />
      </body>
    </html>
  );
}
