import { CreditCard, Money } from '@finanzas/domain';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { toCreditCard, toStoredCreditCard } from '@/data/mappers';
import { createServices, type AppServices } from './create-services';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
let accountId = '';
const NOW = new Date('2026-03-10T15:00:00Z');

beforeEach(async () => {
  dbName = `card-cut-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  s = createServices({ db, now: () => NOW, newId: () => `id-${++seq}` });
  await s.accounts.create({ name: 'Banco', type: 'BANK', initialBalance: '10000000' });
  accountId = (await s.accounts.list())[0]!.id;
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const cardInput = (over = {}) => ({ name: 'Visa', dueDay: 25, paymentAccountId: accountId, feeKind: 'NONE' as const, ...over });

describe('día de corte en el servicio de tarjetas', () => {
  it('guarda el corte y lo muestra; sin corte queda en null', async () => {
    await s.cards.createCard(cardInput({ cutDay: 10 }));
    await s.cards.createCard(cardInput({ name: 'Mastercard' }));
    const cards = await s.cards.list();
    expect(cards.find((c) => c.name === 'Visa')!.cutDay).toBe(10);
    expect(cards.find((c) => c.name === 'Mastercard')!.cutDay).toBeNull();
    expect((await db.getAll('creditCards')).find((r) => r.name === 'Visa')!.cutDay).toBe(10);
  });

  it('rechaza un corte igual al día de pago o fuera de rango', async () => {
    expect(await s.cards.createCard(cardInput({ cutDay: 25 }))).toEqual({ ok: false, error: 'El día de corte no puede ser el mismo día de pago.' });
    expect(await s.cards.createCard(cardInput({ cutDay: 32 }))).toEqual({ ok: false, error: 'El día de corte va de 1 a 31.' });
    expect(await db.count('creditCards')).toBe(0);
  });

  it('editar la tarjeta puede agregar, cambiar o quitar el corte', async () => {
    await s.cards.createCard(cardInput());
    const id = (await s.cards.list())[0]!.id;
    expect(await s.cards.updateCard(id, cardInput({ cutDay: 5 }))).toEqual({ ok: true });
    expect((await s.cards.list())[0]!.cutDay).toBe(5);
    expect(await s.cards.updateCard(id, cardInput())).toEqual({ ok: true });
    expect((await s.cards.list())[0]!.cutDay).toBeNull();
  });

  it('sugiere la primera cuota con el corte; sin corte, como hoy', () => {
    expect(s.cards.suggestFirstDueDate({ dueDay: 25, cutDay: 10 }, '2026-03-10')).toBe('2026-03-25');
    expect(s.cards.suggestFirstDueDate({ dueDay: 25, cutDay: 10 }, '2026-03-11')).toBe('2026-04-25');
    expect(s.cards.suggestFirstDueDate({ dueDay: 25, cutDay: null }, '2026-03-11')).toBe('2026-04-25');
    expect(s.cards.suggestFirstDueDate({ dueDay: 25, cutDay: null }, '2026-03-05')).toBe('2026-04-25');
  });

  it('la vista previa y el guardado reconocen la fecha sugerida con corte (conserva el día 31)', async () => {
    await s.cards.createCard(cardInput({ dueDay: 31, cutDay: 10 }));
    const card = (await s.cards.list())[0]!;
    const input = { cardId: card.id, description: 'Libro', amount: '100000', installments: 2, purchaseDate: '2026-02-05', firstDueDate: '2026-02-28' };
    expect(s.cards.previewPurchase(card, input)).toMatchObject({ ok: true });
    expect(await s.cards.addPurchase(input)).toEqual({ ok: true });
    expect((await db.getAll('cardPurchases'))[0]!.dueDayAnchor).toBe(31);
  });

  it('cambiar el corte no mueve la primera fecha de las compras ya guardadas', async () => {
    await s.cards.createCard(cardInput({ cutDay: 10 }));
    const card = (await s.cards.list())[0]!;
    await s.cards.addPurchase({ cardId: card.id, description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-03-25' });
    await s.cards.updateCard(card.id, cardInput({ cutDay: 20 }));
    expect(String((await db.getAll('cardPurchases'))[0]!.firstDueDate).slice(0, 10)).toBe('2026-03-25');
  });

  it('cambiar el corte avisa de las cuotas de manejo sin pagar que dejarían de verse', async () => {
    await s.cards.createCard(cardInput({ dueDay: 15, cutDay: 10, feeKind: 'FIXED_MONTHLY', feeAmount: '18000' }));
    const id = (await s.cards.list())[0]!.id;
    // Corte 10, pago 15: el manejo de abril vence el 15 de abril. Con corte 20 vence el 15 de mayo, fuera del horizonte.
    expect(await s.cards.cardChangeImpact(id, cardInput({ dueDay: 15, cutDay: 20, feeKind: 'FIXED_MONTHLY', feeAmount: '18000' }))).toEqual({
      lostCount: 1,
      lostAmount: '18000',
      changedCount: 0,
    });
    expect(await s.cards.cardChangeImpact(id, cardInput({ dueDay: 15, cutDay: 10, feeKind: 'FIXED_MONTHLY', feeAmount: '18000' }))).toEqual({ lostCount: 0, lostAmount: '0', changedCount: 0 });
  });

});

describe('tarjeta guardada con y sin corte', () => {
  const props = { id: 'c1', name: 'Visa', dueDay: 15, paymentAccountId: 'a1', fee: { kind: 'NONE' as const }, feeStartMonth: '2026-03' };

  it('ida y vuelta con corte', () => {
    const card = CreditCard.create({ ...props, cutDay: 5 });
    const row = toStoredCreditCard(card);
    expect(row.cutDay).toBe(5);
    expect(toCreditCard(row).cutDay).toBe(5);
  });

  it('ida y vuelta sin corte guarda null', () => {
    const row = toStoredCreditCard(CreditCard.create(props));
    expect(row.cutDay).toBeNull();
    expect(toCreditCard(row).cutDay).toBeUndefined();
  });

  it('una fila vieja sin el campo se sigue leyendo', () => {
    const { cutDay: _omit, ...old } = toStoredCreditCard(CreditCard.create({ ...props, fee: { kind: 'FIXED_MONTHLY', amount: Money.of(100, 'COP') } }));
    expect(toCreditCard(old).cutDay).toBeUndefined();
  });
});
