/**
 * Rutas de la app móvil. El sitio es estático (no existen páginas por cada id), así que
 * lo que cambia (cuenta, movimiento, horizonte) viaja en la dirección como "?parámetro=".
 */
export const routes = {
  home: '/',
  homeHorizon: (h: string) => `/?h=${h}`,
  history: '/historial',
  historyByAccount: (accountId?: string) => (accountId ? `/historial?cuenta=${accountId}` : '/historial'),
  add: '/agregar',
  scheduled: '/programados',
  settings: '/ajustes',
  newAccount: '/cuentas/nueva',
  editAccount: (id: string) => `/cuentas/editar?id=${id}`,
  editTransaction: (id: string) => `/movimientos/editar?id=${id}`,
} as const;
