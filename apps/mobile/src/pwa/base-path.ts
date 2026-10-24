/** Ruta base del sitio: vacía en local y "/<repo>" en GitHub Pages (se fija al compilar). */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

export const withBase = (path: string): string => `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
