const DEFAULT_LISTEN_HOST = '127.0.0.1';

/** Dirección donde escucha la API: solo local salvo que API_HOST diga otra cosa. */
export function resolveListenHost(env: NodeJS.ProcessEnv): string {
  const host = env.API_HOST?.trim();
  return host ? host : DEFAULT_LISTEN_HOST;
}
