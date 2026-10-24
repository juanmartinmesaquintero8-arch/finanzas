import { Injectable } from '@nestjs/common';
import { CachePort } from '../../application/ports/cache.port';

interface Entry {
  value: unknown;
  expiresAt: number;
}

export interface InMemoryCacheOptions {
  maxEntries?: number;
  /** Reloj en milisegundos; inyectable para pruebas. */
  clock?: () => number;
}

/** Caché LRU en memoria con TTL. El orden de inserción del Map actúa como recencia. */
@Injectable()
export class InMemoryCache implements CachePort {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly clock: () => number;

  constructor(options: InMemoryCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 500;
    this.clock = options.clock ?? Date.now;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.clock() + ttlSeconds * 1000 });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }
}
