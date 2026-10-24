import { ACCOUNT_TYPES, AccountType, FREQUENCIES, Frequency, TRANSACTION_TYPES, TransactionType } from '@finanzas/domain';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const INTEGER = /^-?\d+$/;
const AMOUNT_MSG = 'El monto debe ser un entero en unidades mínimas, enviado como texto (ej. "50000")';
const CURRENCY_MSG = 'La moneda debe ser un código ISO de 3 letras mayúsculas (ej. COP)';

export class CreateAccountDto {
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre de la cuenta es obligatorio' })
  @MaxLength(80, { message: 'El nombre no puede superar 80 caracteres' })
  name!: string;

  @IsIn(ACCOUNT_TYPES, { message: `El tipo de cuenta debe ser uno de: ${ACCOUNT_TYPES.join(', ')}` })
  type!: AccountType;

  @IsOptional()
  @Matches(INTEGER, { message: AMOUNT_MSG })
  initialBalance?: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: CURRENCY_MSG })
  currency?: string;
}

export class CreateTransactionDto {
  @IsIn(TRANSACTION_TYPES, { message: `El tipo debe ser uno de: ${TRANSACTION_TYPES.join(', ')}` })
  type!: TransactionType;

  @Matches(INTEGER, { message: AMOUNT_MSG })
  amount!: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: CURRENCY_MSG })
  currency?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha debe estar en formato ISO 8601' })
  date?: string;

  @IsString({ message: 'La descripción debe ser texto' })
  @IsNotEmpty({ message: 'La descripción es obligatoria' })
  @MaxLength(160, { message: 'La descripción no puede superar 160 caracteres' })
  description!: string;

  @IsOptional()
  @IsString({ message: 'La categoría debe ser texto' })
  @MaxLength(60, { message: 'La categoría no puede superar 60 caracteres' })
  category?: string;

  @IsOptional()
  @IsUUID('all', { message: 'accountId debe ser un UUID' })
  accountId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'fromAccountId debe ser un UUID' })
  fromAccountId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'toAccountId debe ser un UUID' })
  toAccountId?: string;
}

export class ListTransactionsQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'accountId debe ser un UUID' })
  accountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  limit?: number;

  @IsOptional()
  @IsString({ message: 'cursor debe ser texto' })
  cursor?: string;
}

export class CreateScheduledExpenseDto {
  @IsString({ message: 'La descripción debe ser texto' })
  @IsNotEmpty({ message: 'La descripción es obligatoria' })
  @MaxLength(160, { message: 'La descripción no puede superar 160 caracteres' })
  description!: string;

  @Matches(INTEGER, { message: AMOUNT_MSG })
  amount!: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: CURRENCY_MSG })
  currency?: string;

  @IsUUID('all', { message: 'accountId debe ser un UUID' })
  accountId!: string;

  @IsIn(FREQUENCIES, { message: `La frecuencia debe ser una de: ${FREQUENCIES.join(', ')}` })
  frequency!: Frequency;

  @IsDateString({}, { message: 'startDate debe tener formato YYYY-MM-DD' })
  startDate!: string;

  @IsOptional()
  @IsDateString({}, { message: 'endDate debe tener formato YYYY-MM-DD' })
  endDate?: string;
}

export class SettleScheduledExpenseDto {
  @IsDateString({}, { message: 'through debe tener formato YYYY-MM-DD' })
  through!: string;

  @IsOptional()
  @IsBoolean({ message: 'createTransactions debe ser booleano' })
  createTransactions?: boolean;
}

export class ProjectionQueryDto {
  @IsDateString({}, { message: 'El parámetro "to" es obligatorio y debe tener formato YYYY-MM-DD' })
  to!: string;
}

/** PUT /transactions/:id usa el mismo cuerpo que POST. */
export class UpdateTransactionDto extends CreateTransactionDto {}

/** PUT /scheduled-expenses/:id usa el mismo cuerpo que POST. */
export class UpdateScheduledExpenseDto extends CreateScheduledExpenseDto {}

export class UpdateAccountDto {
  @IsOptional()
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre de la cuenta es obligatorio' })
  @MaxLength(80, { message: 'El nombre no puede superar 80 caracteres' })
  name?: string;

  @IsOptional()
  @IsIn(ACCOUNT_TYPES, { message: `El tipo de cuenta debe ser uno de: ${ACCOUNT_TYPES.join(', ')}` })
  type?: AccountType;

  @IsOptional()
  @Matches(INTEGER, { message: AMOUNT_MSG })
  initialBalance?: string;
}
