import type { WagerTransactionStatus } from '../../domain/wager-transaction.js';

interface LatencyMetric {
  count: number;
  totalMs: number;
  maxMs: number;
}

export class OperationalMetrics {
  private readonly transactionsByStatus: Record<string, number> = {};
  private duplicates = 0;
  private retries = 0;
  private dlqMessages = 0;
  private lockConflicts = 0;
  private outboxLagMs = 0;
  private reconciliationMismatches = 0;
  private readonly processingLatency: LatencyMetric = {
    count: 0,
    totalMs: 0,
    maxMs: 0,
  };

  recordTransaction(status: WagerTransactionStatus): void {
    this.transactionsByStatus[status] =
      (this.transactionsByStatus[status] ?? 0) + 1;
  }

  recordDuplicate(): void {
    this.duplicates++;
  }

  recordRetry(): void {
    this.retries++;
  }

  setDlqMessages(count: number): void {
    this.dlqMessages = count;
  }

  recordLockConflict(): void {
    this.lockConflicts++;
  }

  setOutboxLag(milliseconds: number): void {
    this.outboxLagMs = Math.max(0, milliseconds);
  }

  recordProcessingLatency(milliseconds: number): void {
    this.processingLatency.count++;
    this.processingLatency.totalMs += milliseconds;
    this.processingLatency.maxMs = Math.max(
      this.processingLatency.maxMs,
      milliseconds,
    );
  }

  recordReconciliationMismatch(): void {
    this.reconciliationMismatches++;
  }

  snapshot() {
    const { count, totalMs, maxMs } = this.processingLatency;

    return {
      transactionsByStatus: { ...this.transactionsByStatus },
      duplicates: this.duplicates,
      retries: this.retries,
      dlqMessages: this.dlqMessages,
      lockConflicts: this.lockConflicts,
      outboxLagMs: this.outboxLagMs,
      processingLatencyMs: {
        count,
        average: count === 0 ? 0 : totalMs / count,
        max: maxMs,
      },
      reconciliationMismatches: this.reconciliationMismatches,
    };
  }

  reset(): void {
    for (const status of Object.keys(this.transactionsByStatus)) {
      delete this.transactionsByStatus[status];
    }

    this.duplicates = 0;
    this.retries = 0;
    this.dlqMessages = 0;
    this.lockConflicts = 0;
    this.outboxLagMs = 0;
    this.reconciliationMismatches = 0;
    this.processingLatency.count = 0;
    this.processingLatency.totalMs = 0;
    this.processingLatency.maxMs = 0;
  }
}

export const operationalMetrics = new OperationalMetrics();
