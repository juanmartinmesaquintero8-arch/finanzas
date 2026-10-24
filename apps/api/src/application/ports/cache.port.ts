/** Puerto de caché (DIP): en desarrollo en memoria (LRU); en producción Redis, sin tocar casos de uso. */
export interface CachePort {
  get<T>(key: string): Promise<T | undefined>;
  /** `ttlSeconds` es solo una red de seguridad; la invalidación principal es por eventos. */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}

export const CACHE_PORT = Symbol('CachePort');
