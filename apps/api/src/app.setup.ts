import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DomainExceptionFilter } from './infrastructure/http/domain-exception.filter';

export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

/** Configuración común a main.ts y a las pruebas e2e. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableCors({ origin: WEB_ORIGIN, exposedHeaders: ['ETag'] });
}
