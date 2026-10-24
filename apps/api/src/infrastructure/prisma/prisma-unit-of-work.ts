import { Injectable } from '@nestjs/common';
import { TransactionalRepositories, UnitOfWork } from '../../application/ports/unit-of-work.port';
import { PrismaAccountRepository } from './prisma-account.repository';
import { PrismaScheduledExpenseRepository } from './prisma-scheduled-expense.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaService } from './prisma.service';

/** Ejecuta el trabajo dentro de una única transacción de BD (`$transaction` interactiva). */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      work({
        accounts: new PrismaAccountRepository(tx),
        transactions: new PrismaTransactionRepository(tx),
        scheduledExpenses: new PrismaScheduledExpenseRepository(tx),
      }),
    );
  }
}
