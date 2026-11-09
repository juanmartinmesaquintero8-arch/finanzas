import type { CardPurchase, CardPurchaseRepository, CreditCard, CreditCardRepository } from '@finanzas/domain';
import type { FinanzasDb } from './database';
import { toCardPurchase, toCreditCard, toStoredCardPurchase, toStoredCreditCard } from './mappers';

/** Adaptador IndexedDB del puerto CreditCardRepository. */
export class IdbCreditCardRepository implements CreditCardRepository {
  constructor(private readonly db: FinanzasDb) {}

  async findAll(): Promise<CreditCard[]> {
    return (await this.db.getAll('creditCards')).map(toCreditCard);
  }

  async findById(id: string): Promise<CreditCard | null> {
    const row = await this.db.get('creditCards', id);
    return row ? toCreditCard(row) : null;
  }

  async save(card: CreditCard): Promise<void> {
    await this.db.put('creditCards', toStoredCreditCard(card));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete('creditCards', id);
  }
}

/** Adaptador IndexedDB del puerto CardPurchaseRepository. */
export class IdbCardPurchaseRepository implements CardPurchaseRepository {
  constructor(private readonly db: FinanzasDb) {}

  async findAll(): Promise<CardPurchase[]> {
    return (await this.db.getAll('cardPurchases')).map(toCardPurchase);
  }

  async findById(id: string): Promise<CardPurchase | null> {
    const row = await this.db.get('cardPurchases', id);
    return row ? toCardPurchase(row) : null;
  }

  async findByCard(cardId: string): Promise<CardPurchase[]> {
    return (await this.db.getAllFromIndex('cardPurchases', 'by-card', cardId)).map(toCardPurchase);
  }

  async save(purchase: CardPurchase): Promise<void> {
    await this.db.put('cardPurchases', toStoredCardPurchase(purchase));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete('cardPurchases', id);
  }
}
