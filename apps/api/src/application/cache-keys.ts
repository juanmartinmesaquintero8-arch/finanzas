/** Claves versionadas y con namespace (CLAUDE.md §7.3). El usuario es `default` hasta que exista autenticación. */
export const DEFAULT_USER = 'default';

export const CACHE_PREFIXES = {
  summary: 'summary:v1:',
  projection: 'projection:v1:',
} as const;

export const CACHE_KEYS = {
  summary: (userId = DEFAULT_USER) => `${CACHE_PREFIXES.summary}${userId}`,
  projection: (from: string, to: string, userId = DEFAULT_USER) =>
    `${CACHE_PREFIXES.projection}${userId}:${from}:${to}`,
};

/** TTL de seguridad: la invalidación principal es por eventos. */
export const SAFETY_TTL_SECONDS = 60;
