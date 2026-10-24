import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @finanzas/ui se publica como TypeScript + CSS Modules sin compilar.
  transpilePackages: ['@finanzas/ui'],
};

export default config;
