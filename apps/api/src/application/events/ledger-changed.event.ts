export type LedgerChangeReason = 'account' | 'transaction' | 'scheduled-expense';

/** Evento de dominio de aplicación: algo que afecta saldos o proyecciones cambió. */
export class LedgerChangedEvent {
  constructor(readonly reason: LedgerChangeReason) {}
}
