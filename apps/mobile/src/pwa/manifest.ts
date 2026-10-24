export interface ManifestIcon {
  src: string;
  sizes: string;
  type: 'image/png';
  purpose: 'any' | 'maskable';
}

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  orientation: 'portrait';
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

const icon = (basePath: string, file: string, size: number, purpose: ManifestIcon['purpose']): ManifestIcon => ({
  src: `${basePath}/icons/${file}`,
  sizes: `${size}x${size}`,
  type: 'image/png',
  purpose,
});

/** Manifiesto de la PWA. `basePath` es "" en local y "/<repo>" en GitHub Pages. */
export function buildManifest(basePath: string): WebManifest {
  return {
    id: `${basePath}/`,
    name: 'Mis Finanzas',
    short_name: 'Finanzas',
    description: 'Controla tu dinero: cuentas, movimientos y gastos programados. Tus datos quedan solo en tu celular.',
    lang: 'es',
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f6f5',
    theme_color: '#0b6b4f',
    icons: [
      icon(basePath, 'icon-192.png', 192, 'any'),
      icon(basePath, 'icon-512.png', 512, 'any'),
      icon(basePath, 'icon-maskable-192.png', 192, 'maskable'),
      icon(basePath, 'icon-maskable-512.png', 512, 'maskable'),
    ],
  };
}
