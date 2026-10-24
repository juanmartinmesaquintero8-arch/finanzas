import { render } from '@testing-library/react';
import { deleteDB } from 'idb';
import type { ReactElement } from 'react';
import { afterEach, vi } from 'vitest';
import { createServices, type AppServices } from '@/application/create-services';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { ServicesProvider } from '@/state/services-provider';

const opened: { db: FinanzasDb; name: string }[] = [];

afterEach(async () => {
  while (opened.length) {
    const { db, name } = opened.pop()!;
    db.close();
    await deleteDB(name);
  }
});

export const NOW = new Date('2026-03-10T15:00:00Z');

/** Servicios reales sobre una IndexedDB falsa y aislada por prueba. */
export async function makeServices(now: Date = NOW): Promise<AppServices> {
  const name = `ui-${Math.random()}`;
  const db = await openFinanzasDb(name);
  opened.push({ db, name });
  let seq = 0;
  return createServices({ db, now: () => now, newId: () => `id-${++seq}` });
}

export async function renderWithServices(ui: ReactElement, services?: AppServices) {
  const svc = services ?? (await makeServices());
  const view = render(<ServicesProvider loadServices={async () => svc}>{ui}</ServicesProvider>);
  return { services: svc, ...view };
}

export const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
