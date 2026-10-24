import { Account } from '../account/account';
import { Money } from '../money/money';
import { Transaction } from '../transaction/transaction';

export class UnknownAccountError extends Error {
  constructor(accountId: string) {
    super(`Cuenta desconocida: ${accountId}`);
    this.name = 'UnknownAccountError';
  }
}

export interface AccountBalance {
  accountId: string;
  balance: Money;
}

export class BalanceSnapshot {
  constructor(
    readonly balances: readonly AccountBalance[],
    readonly netWorth: Money,
  ) {}

  balanceOf(accountId: string): Money {
    const found = this.balances.find((b) => b.accountId === accountId);
    if (!found) throw new UnknownAccountError(accountId);
    return found.balance;
  }
}

/** Servicio de dominio puro: deriva saldos por cuenta y patrimonio total desde el ledger. */
export class BalanceCalculator {
  constructor(private readonly currency: string) {}

  calculate(accounts: readonly Account[], transactions: readonly Transaction[], asOf?: Date): BalanceSnapshot {
    const running = new Map<string, Money>(accounts.map((a) => [a.id, a.initialBalance]));

    for (const tx of transactions) {
      if (asOf && tx.date.getTime() > asOf.getTime()) continue;
      for (const { accountId, delta } of tx.effects()) {
        const current = running.get(accountId);
        if (!current) throw new UnknownAccountError(accountId);
        running.set(accountId, current.add(delta));
      }
    }

    const balances = accounts.map((a) => ({ accountId: a.id, balance: running.get(a.id)! }));
    const netWorth = Money.sum(balances.map((b) => b.balance), this.currency);
    return new BalanceSnapshot(balances, netWorth);
  }

  /**
   * Construye el snapshot desde totales ya agregados (p. ej. SUM ... GROUP BY en SQL),
   * evitando cargar todo el ledger en memoria. deltas = variación neta por cuenta.
   */
  fromTotals(accounts: readonly Account[], deltas: ReadonlyMap<string, bigint>): BalanceSnapshot {
    const known = new Set(accounts.map((a) => a.id));
    for (const accountId of deltas.keys()) {
      if (!known.has(accountId)) throw new UnknownAccountError(accountId);
    }
    const balances = accounts.map((a) => ({
      accountId: a.id,
      balance: a.initialBalance.add(Money.of(deltas.get(a.id) ?? 0n, a.currency)),
    }));
    return new BalanceSnapshot(balances, Money.sum(balances.map((b) => b.balance), this.currency));
  }
}