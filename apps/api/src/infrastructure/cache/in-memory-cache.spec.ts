import { InMemoryCache } from './in-memory-cache';

describe('InMemoryCache', () => {
  let now: number;
  const clock = () => now;

  beforeEach(() => {
    now = 1_000;
  });

  it('devuelve undefined cuando la clave no existe', async () => {
    const cache = new InMemoryCache({ clock });
    expect(await cache.get('x')).toBeUndefined();
  });

  it('guarda y recupera valores', async () => {
    const cache = new InMemoryCache({ clock });
    await cache.set('a', { n: 1 }, 60);
    expect(await cache.get('a')).toEqual({ n: 1 });
  });

  it('expira las entradas pasado el TTL', async () => {
    const cache = new InMemoryCache({ clock });
    await cache.set('a', 1, 60);
    now += 59_999;
    expect(await cache.get('a')).toBe(1);
    now += 2;
    expect(await cache.get('a')).toBeUndefined();
  });

  it('delete elimina una clave', async () => {
    const cache = new InMemoryCache({ clock });
    await cache.set('a', 1, 60);
    await cache.delete('a');
    expect(await cache.get('a')).toBeUndefined();
  });

  it('deleteByPrefix elimina solo las claves con ese prefijo', async () => {
    const cache = new InMemoryCache({ clock });
    await cache.set('projection:v1:default:a:b', 1, 60);
    await cache.set('projection:v1:default:c:d', 2, 60);
    await cache.set('summary:v1:default', 3, 60);
    await cache.deleteByPrefix('projection:v1:');
    expect(await cache.get('projection:v1:default:a:b')).toBeUndefined();
    expect(await cache.get('projection:v1:default:c:d')).toBeUndefined();
    expect(await cache.get('summary:v1:default')).toBe(3);
  });

  it('desaloja la entrada menos usada recientemente (LRU) al superar la capacidad', async () => {
    const cache = new InMemoryCache({ clock, maxEntries: 2 });
    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);
    await cache.get('a'); // a pasa a ser la más reciente
    await cache.set('c', 3, 60);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBe(1);
    expect(await cache.get('c')).toBe(3);
  });
});
