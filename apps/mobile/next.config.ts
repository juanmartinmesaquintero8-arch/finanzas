import type { NextConfig } from 'next';

// Vacío en local; en GitHub Pages es "/<nombre-del-repo>".
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Sitio 100 % estático: todo se calcula en el teléfono.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // @finanzas/ui se publica como TypeScript + CSS Modules sin compilar.
  transpilePackages: ['@finanzas/ui'],
};

export default config;
