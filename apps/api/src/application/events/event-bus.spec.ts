import { CACHE_KEYS } from '../cache-keys';
import { InMemoryCache } from '../../infrastructure/cache/in-memory-cache';
import { EventBus } from './event-bus';
import { LedgerChangedEvent } from './ledger-changed.event';
import { InvalidateCachesOnLedgerChange } from './invalidate-caches.listener';

describe('EventBus (Observer)', () => {
  it('notifica a todos los suscriptores del evento publicado', async () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.subscribe(LedgerChangedEvent, (e) => void received.push(`a:${e.reason}`));
    bus.subscribe(LedgerChangedEvent, async (e) => void received.push(`b:${e.reason}`));
    await bus.publish(new LedgerChangedEvent('transaction'));
    expect(received).toEqual(['a:transaction', 'b:transaction']);
  });

  it('permite cancelar la suscripción', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const unsubscribe = bus.subscribe(LedgerChangedEvent, handler);
    unsubscribe();
    await bus.publish(new LedgerChangedEvent('account'));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('InvalidateCachesOnLedgerChange', () => {
  it('borra summary y projection al publicarse un LedgerChangedEvent', async () => {
    const bus = new EventBus();
    const cache = new InMemoryCache();
    new InvalidateCachesOnLedgerChange(bus, cache).onModuleInit();
    await cache.set(CACHE_KEYS.summary(), 1, 60);
    await cache.set(CACHE_KEYS.projection('2026-10-01', '2026-12-31'), 2, 60);
    await cache.set('otra:clave', 3, 60);

    await bus.publish(new LedgerChangedEvent('scheduled-expense'));

    expect(await cache.get(CACHE_KEYS.summary())).toBeUndefined();
    expect(await cache.get(CACHE_KEYS.projection('2026-10-01', '2026-12-31'))).toBeUndefined();
    expect(await cache.get('otra:clave')).toBe(3);
  });
});
