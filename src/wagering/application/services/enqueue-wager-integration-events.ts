import type { EntityManager } from '@mikro-orm/postgresql';

import {
  type IntegrationEvent,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '../../domain/integration-event.js';
import { OutboxMessage } from '../../domain/outbox-message.js';
import {
  type WagerTransaction,
  WagerTransactionStatus,
} from '../../domain/wager-transaction.js';
import type { WalletLedgerEntry } from '../../domain/wallet-ledger-entry.js';
import type { Wallet } from '../../domain/wallet.js';
import { MikroOrmOutboxMessageRepository } from '../../infrastructure/persistence/repositories/mikro-orm-outbox-message.repository.js';

interface EnqueueWagerIntegrationEventsInput {
  transaction: WagerTransaction;
  wallet: Wallet;
  ledgerEntry?: WalletLedgerEntry;
}

export async function enqueueWagerIntegrationEvents(
  entityManager: EntityManager,
  input: EnqueueWagerIntegrationEventsInput,
): Promise<void> {
  const context = {
    correlationId: input.transaction.id,
    occurredAt: new Date(),
  };
  const events: IntegrationEvent<unknown>[] = [];

  switch (input.transaction.status) {
    case WagerTransactionStatus.Processed:
      events.push(WagerTransactionProcessed.from(input.transaction, context));
      break;

    case WagerTransactionStatus.Rejected:
      events.push(WagerTransactionRejected.from(input.transaction, context));
      break;

    case WagerTransactionStatus.PendingReference:
      events.push(
        WagerTransactionPendingReference.from(input.transaction, context),
      );
      break;
  }

  if (input.ledgerEntry) {
    events.push(
      WalletBalanceChanged.from(input.wallet, input.ledgerEntry, context),
    );
  }

  if (events.length === 0) {
    return;
  }

  const repository = new MikroOrmOutboxMessageRepository(entityManager);
  await repository.insert(events.map(OutboxMessage.enqueue));
}
