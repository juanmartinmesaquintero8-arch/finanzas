import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Cliente que puede ser el pool global o el cliente de una transacción interactiva. */
export type PrismaExecutor = Prisma.TransactionClient;

/** El tamaño del pool se configura vía `DATABASE_URL` (`?connection_limit=`). */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
