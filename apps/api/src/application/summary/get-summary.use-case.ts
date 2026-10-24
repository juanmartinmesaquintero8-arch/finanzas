import { Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  BalanceCalculator,
  TRANSACTION_REPOSITORY,
  TransactionRepository,
} from '@finanzas/domain';
import { CACHE_KEYS } from '../cache-keys';
import { DEFAULT_CURRENCY } from '../config';
import { CACHE_PORT, CachePort } from '../ports/cache.port';
import { readThrough } from '../read-through';
import { MoneyView } from '../views';

export interface SummaryView {
  netWorth: MoneyView;
  accounts: { accountId: string; name: string; type: string; balance: MoneyView }[];
}

@Injectable()
export class GetSummaryUseCase {
  private readonly calculator = new BalanceCalculator(DEFAULT_CURRENCY);

  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  execute(): Promise<SummaryView> {
    return readThrough(this.cache, CACHE_KEYS.summary(), () => this.compute());
  }

  private async compute(): Promise<SummaryView> {
    // Dos consultas constantes (cuentas + totales agregados por SQL); nunca se carga el ledger.
    const [accounts, deltas] = await Promise.all([this.accounts.findAll(), this.transactions.balanceDeltas()]);
    const snapshot = this.calculator.fromTotals(accounts, deltas);
    return {
      netWorth: snapshot.netWorth.toJSON(),
      accounts: accounts.map((a) => ({
        accountId: a.id,
        name: a.name,
        type: a.type,
        balance: snapshot.balanceOf(a.id).toJSON(),
      })),
    };
  }
}
