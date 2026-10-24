import { SAFETY_TTL_SECONDS } from './cache-keys';
import { CachePort } from './ports/cache.port';

/** Cache-aside: devuelve el valor cacheado o lo calcula, lo guarda (TTL de seguridad) y lo devuelve. */
export async function readThrough<T>(cache: CachePort, key: string, loader: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  await cache.set(key, value, SAFETY_TTL_SECONDS);
  return value;
}
