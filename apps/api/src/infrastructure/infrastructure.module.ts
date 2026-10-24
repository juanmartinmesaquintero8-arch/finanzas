import { Global, Module } from '@nestjs/common';
import {
  ACCOUNT_REPOSITORY,
  SCHEDULED_EXPENSE_REPOSITORY,
  TRANSACTION_REPOSITORY,
} from '@finanzas/domain';
import { EventBus } from '../application/events/event-bus';
import { InvalidateCachesOnLedgerChange } from '../application/events/invalidate-caches.listener';
import { CACHE_PORT } from '../application/ports/cache.port';
import { CLOCK, systemClock } from '../application/ports/clock.port';
import { UNIT_OF_WORK } from '../application/ports/unit-of-work.port';
import { InMemoryCache } from './cache/in-memory-cache';
import { PrismaAccountRepository } from './prisma/prisma-account.repository';
import { PrismaScheduledExpenseRepository } from './prisma/prisma-scheduled-expense.repository';
import { PrismaTransactionRepository } from './prisma/prisma-transaction.repository';
import { PrismaUnitOfWork } from './prisma/prisma-unit-of-work';
import { PrismaService } from './prisma/prisma.service';

/** Cablea los puertos con sus adaptadores (Prisma, caché en memoria, reloj, bus de eventos). */
@Global()
@Module({
  providers: [
    PrismaService,
    EventBus,
    InvalidateCachesOnLedgerChange,
    { provide: ACCOUNT_REPOSITORY, inject: [PrismaService], useFactory: (p: PrismaService) => new PrismaAccountRepository(p) },
    { provide: TRANSACTION_REPOSITORY, inject: [PrismaService], useFactory: (p: PrismaService) => new PrismaTransactionRepository(p) },
    {
      provide: SCHEDULED_EXPENSE_REPOSITORY,
      inject: [PrismaService],
      useFactory: (p: PrismaService) => new PrismaScheduledExpenseRepository(p),
    },
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
    { provide: CACHE_PORT, useFactory: () => new InMemoryCache() },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [
    PrismaService,
    EventBus,
    ACCOUNT_REPOSITORY,
    TRANSACTION_REPOSITORY,
    SCHEDULED_EXPENSE_REPOSITORY,
    UNIT_OF_WORK,
    CACHE_PORT,
    CLOCK,
  ],
})
export class InfrastructureModule {}
