import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import {
  CurrencyMismatchError,
  DomainValidationError,
  InvalidMoneyError,
  UnknownAccountError,
} from '@finanzas/domain';
import type { Response } from 'express';
import { EntityNotFoundError, InvalidRequestError } from '../../application/errors';

const STATUS_ERRORS: { type: new (...args: never[]) => Error; status: HttpStatus }[] = [
  { type: DomainValidationError, status: HttpStatus.UNPROCESSABLE_ENTITY },
  { type: CurrencyMismatchError, status: HttpStatus.UNPROCESSABLE_ENTITY },
  { type: InvalidMoneyError, status: HttpStatus.BAD_REQUEST },
  { type: InvalidRequestError, status: HttpStatus.BAD_REQUEST },
  { type: UnknownAccountError, status: HttpStatus.NOT_FOUND },
  { type: EntityNotFoundError, status: HttpStatus.NOT_FOUND },
];

const REASONS: Record<number, string> = {
  400: 'Solicitud inválida',
  404: 'No encontrado',
  422: 'Entidad no procesable',
  500: 'Error interno',
};

/** Traduce errores de dominio/aplicación a respuestas HTTP con mensajes en español. */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, message } = this.translate(exception);
    res.status(status).json({ statusCode: status, error: REASONS[status] ?? 'Error', message });
  }

  private translate(exception: unknown): { status: number; message: string | string[] } {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : ((body as { message?: string | string[] }).message ?? exception.message);
      return { status: exception.getStatus(), message: this.localize(exception.getStatus(), message) };
    }
    const mapped = STATUS_ERRORS.find((e) => exception instanceof e.type);
    if (mapped) return { status: mapped.status, message: (exception as Error).message };

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Ocurrió un error inesperado en el servidor' };
  }

  private localize(status: number, message: string | string[]): string | string[] {
    if (status === 404 && typeof message === 'string' && message.startsWith('Cannot ')) return 'Ruta no encontrada';
    if (typeof message === 'string' && message.startsWith('Validation failed (uuid')) return 'El identificador debe ser un UUID válido';
    return message;
  }
}
