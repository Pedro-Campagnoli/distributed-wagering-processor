import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';

import { ProcessWagerTransactionUseCase } from '../../application/use-cases/process-wager-transaction.use-case.js';
import { MikroOrmWagerTransactionRepository } from '../persistence/repositories/mikro-orm-wager-transaction.repository.js';

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 100;

export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly entityManager: EntityManager) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    const entityManager = this.entityManager.fork();
    const repository = new MikroOrmWagerTransactionRepository(entityManager);
    const transactions = await repository.findPendingReferencesDue(
      now,
      BATCH_SIZE,
    );

    for (const transaction of transactions) {
      const useCase = new ProcessWagerTransactionUseCase(
        this.entityManager.fork(),
      );

      await useCase.reprocessPending(transaction.id, transaction.walletId, now);
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
