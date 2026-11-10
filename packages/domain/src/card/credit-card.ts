import { Money } from '../money/money';
import { assertDomain } from '../shared/domain-validation.error';
import { InterestRate } from './interest-rate';

export type CardFee =
  | { kind: 'NONE' }
  | { kind: 'FIXED_MONTHLY'; amount: Money }
  | { kind: 'ON_MOVEMENT'; amount: Money };

/** Mes calendario en formato `YYYY-MM`. */
export type YearMonth = string;

const YEAR_MONTH = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;

export interface CreditCardProps {
  id: string;
  name: string;
  dueDay: number;
  /** Día en que el banco cierra el extracto (1-31, distinto del día de pago). */
  cutDay?: number;
  paymentAccountId: string;
  fee: CardFee;
  rate?: InterestRate;
  feeStartMonth: YearMonth;
  feesSettledThrough?: YearMonth;
}

/** Tarjeta de crédito: día de pago, cuenta desde la que se paga, cuota de manejo y tasa por defecto. */
export class CreditCard {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly dueDay: number,
    readonly paymentAccountId: string,
    readonly fee: CardFee,
    readonly feeStartMonth: YearMonth,
    readonly rate?: InterestRate,
    readonly feesSettledThrough?: YearMonth,
    readonly cutDay?: number,
  ) {}

  static create(props: CreditCardProps): CreditCard {
    const name = props.name.trim();
    assertDomain(name.length > 0, 'El nombre de la tarjeta es obligatorio');
    assertDomain(Number.isInteger(props.dueDay) && props.dueDay >= 1 && props.dueDay <= 31, 'El día de pago debe estar entre 1 y 31');
    if (props.cutDay !== undefined) {
      assertDomain(Number.isInteger(props.cutDay) && props.cutDay >= 1 && props.cutDay <= 31, 'El día de corte va de 1 a 31.');
      assertDomain(props.cutDay !== props.dueDay, 'El día de corte no puede ser el mismo día de pago.');
    }
    assertDomain(props.paymentAccountId.length > 0, 'La tarjeta necesita una cuenta de pago');
    if (props.fee.kind !== 'NONE') {
      assertDomain(props.fee.amount.isPositive(), 'La cuota de manejo debe ser mayor que cero');
    }
    assertDomain(YEAR_MONTH.test(props.feeStartMonth), 'El mes de inicio del manejo debe tener formato AAAA-MM');
    if (props.feesSettledThrough !== undefined) {
      assertDomain(YEAR_MONTH.test(props.feesSettledThrough), 'El último mes de manejo pagado debe tener formato AAAA-MM');
    }
    return new CreditCard(
      props.id,
      name,
      props.dueDay,
      props.paymentAccountId,
      props.fee,
      props.feeStartMonth,
      props.rate,
      props.feesSettledThrough,
      props.cutDay,
    );
  }

  toProps(): CreditCardProps {
    return {
      id: this.id,
      name: this.name,
      dueDay: this.dueDay,
      cutDay: this.cutDay,
      paymentAccountId: this.paymentAccountId,
      fee: this.fee,
      rate: this.rate,
      feeStartMonth: this.feeStartMonth,
      feesSettledThrough: this.feesSettledThrough,
    };
  }
}
