import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CACHE_PREFIXES } from '../cache-keys';
import { CACHE_PORT, CachePort } from '../ports/cache.port';
import { EventBus } from './event-bus';
import { LedgerChangedEvent } from './ledger-changed.event';

/** Suscriptor que invalida las lecturas cacheadas cuando el ledger cambia. */
@Injectable()
export class InvalidateCachesOnLedgerChange implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe(LedgerChangedEvent, async () => {
      await Promise.all([
        this.cache.deleteByPrefix(CACHE_PREFIXES.summary),
        this.cache.deleteByPrefix(CACHE_PREFIXES.projection),
      ]);
    });
  }
}
