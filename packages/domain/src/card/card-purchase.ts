import { Money } from '../money/money';
import { startOfDayUTC } from '../shared/date';
import { assertDomain } from '../shared/domain-validation.error';

export const MAX_INSTALLMENTS = 72;

export interface CardPurchaseProps {
  id: string;
  cardId: string;
  description: string;
  category?: string;
  amount: Money;
  installments: number;
  purchaseDate: Date;
  firstDueDate: Date;
  /** Tasa mensual en ppm copiada al crear la compra (0 = sin interés). */
  monthlyRatePpm: number;
  paidInstallments: number;
  closedOn?: Date;
}

function assertValidDate(date: Date, message: string): void {
  assertDomain(date instanceof Date && !Number.isNaN(date.getTime()), message);
}

/** Compra con tarjeta a cuotas. Las cuotas no se guardan: se calculan desde la compra (ver installments.ts). */
export class CardPurchase {
  private constructor(
    readonly id: string,
    readonly cardId: string,
    readonly description: string,
    readonly amount: Money,
    readonly installments: number,
    readonly purchaseDate: Date,
    readonly firstDueDate: Date,
    readonly monthlyRatePpm: number,
    readonly paidInstallments: number,
    readonly category?: string,
    readonly closedOn?: Date,
  ) {}

  static create(props: CardPurchaseProps): CardPurchase {
    const description = props.description.trim();
    assertDomain(description.length > 0, 'La descripción de la compra es obligatoria');
    assertDomain(props.amount.isPositive(), 'El monto de la compra debe ser mayor que cero');
    assertDomain(
      Number.isInteger(props.installments) && props.installments >= 1 && props.installments <= MAX_INSTALLMENTS,
      `Las cuotas deben ser un entero entre 1 y ${MAX_INSTALLMENTS}`,
    );
    assertValidDate(props.purchaseDate, 'La fecha de compra no es válida');
    assertValidDate(props.firstDueDate, 'La fecha de la primera cuota no es válida');
    const purchaseDate = startOfDayUTC(props.purchaseDate);
    const firstDueDate = startOfDayUTC(props.firstDueDate);
    assertDomain(firstDueDate.getTime() >= purchaseDate.getTime(), 'La primera cuota no puede ser anterior a la compra');
    assertDomain(Number.isSafeInteger(props.monthlyRatePpm) && props.monthlyRatePpm >= 0, 'La tasa mensual debe ser un entero de 0 en adelante');
    assertDomain(
      Number.isInteger(props.paidInstallments) && props.paidInstallments >= 0 && props.paidInstallments <= props.installments,
      'Las cuotas pagadas deben ir de 0 al total de cuotas',
    );
    let closedOn: Date | undefined;
    if (props.closedOn !== undefined) {
      assertValidDate(props.closedOn, 'La fecha de cierre no es válida');
      closedOn = startOfDayUTC(props.closedOn);
    }
    return new CardPurchase(
      props.id,
      props.cardId,
      description,
      props.amount,
      props.installments,
      purchaseDate,
      firstDueDate,
      props.monthlyRatePpm,
      props.paidInstallments,
      props.category?.trim() || undefined,
      closedOn,
    );
  }

  get isClosed(): boolean {
    return this.closedOn !== undefined;
  }

  /** Marca como pagadas las cuotas hasta la número `through` (repetirlo con el mismo valor no cambia nada). */
  markPaid(through: number): CardPurchase {
    assertDomain(!this.isClosed, 'La compra está cerrada');
    assertDomain(
      Number.isInteger(through) && through >= this.paidInstallments && through <= this.installments,
      'La cuota indicada no es válida',
    );
    return CardPurchase.create({ ...this.toProps(), paidInstallments: through });
  }

  /** Deshace el último pago; sin pagos, devuelve la misma compra. */
  undoLastPayment(): CardPurchase {
    if (this.paidInstallments === 0) return this;
    return CardPurchase.create({ ...this.toProps(), paidInstallments: this.paidInstallments - 1 });
  }

  close(on: Date): CardPurchase {
    return CardPurchase.create({ ...this.toProps(), closedOn: on });
  }

  toProps(): CardPurchaseProps {
    return {
      id: this.id,
      cardId: this.cardId,
      description: this.description,
      category: this.category,
      amount: this.amount,
      installments: this.installments,
      purchaseDate: this.purchaseDate,
      firstDueDate: this.firstDueDate,
      monthlyRatePpm: this.monthlyRatePpm,
      paidInstallments: this.paidInstallments,
      closedOn: this.closedOn,
    };
  }
}
