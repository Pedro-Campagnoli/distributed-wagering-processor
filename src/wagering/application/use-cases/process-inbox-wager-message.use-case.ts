import type { EntityManager } from '@mikro-orm/postgresql';

import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionOutput,
} from './process-wager-transaction.use-case.js';
import { Money } from '../../domain/money.js';
import { InboxMessageOrmEntity } from '../../infrastructure/persistence/entities/inbox-message.orm-entity.js';
import { MikroOrmInboxMessageRepository } from '../../infrastructure/persistence/repositories/mikro-orm-inbox-message.repository.js';
import {
  InvalidWagerTransactionMessageError,
  parseWagerTransactionMessage,
} from '../../infrastructure/messaging/wager-transaction.message.js';
import { hashCanonicalPayload } from '../services/wager-payload-hash.js';

export interface ProcessInboxWagerMessageInput {
  consumerName: string;
  body: string;
}

export interface ProcessInboxWagerMessageOutput {
  alreadyProcessed: boolean;
  result?: ProcessWagerTransactionOutput;
}

export class DuplicateInboxMessageConflictError extends Error {
  constructor(messageId: string) {
    super(`Inbox message reused with different payload: ${messageId}`);
    this.name = 'DuplicateInboxMessageConflictError';
  }
}

export class ProcessInboxWagerMessageUseCase {
  constructor(private readonly entityManager: EntityManager) {}

  execute(
    input: ProcessInboxWagerMessageInput,
  ): Promise<ProcessInboxWagerMessageOutput> {
    const message = parseWagerTransactionMessage(input.body);
    const payloadHash = hashCanonicalPayload(message);

    return this.entityManager.fork().transactional(async (tx) => {
      const inboxRepository = new MikroOrmInboxMessageRepository(tx);
      let inboxMessage = await inboxRepository.find(
        input.consumerName,
        message.messageId,
      );

      if (inboxMessage && inboxMessage.payloadHash !== payloadHash) {
        throw new DuplicateInboxMessageConflictError(message.messageId);
      }

      if (inboxMessage?.processedAt) {
        return { alreadyProcessed: true };
      }

      if (!inboxMessage) {
        inboxMessage = new InboxMessageOrmEntity();
        inboxMessage.consumerName = input.consumerName;
        inboxMessage.messageId = message.messageId;
        inboxMessage.payloadHash = payloadHash;
        inboxMessage.receivedAt = new Date();
        inboxMessage.processedAt = null;

        await inboxRepository.insert(inboxMessage);
      }

      let money: Money;

      try {
        money = Money.from(message.data.money);
      } catch {
        throw new InvalidWagerTransactionMessageError();
      }

      const result = await new ProcessWagerTransactionUseCase(tx).execute({
        ...message.data,
        money,
      });

      await inboxRepository.markProcessed(inboxMessage, new Date());

      return {
        alreadyProcessed: false,
        result,
      };
    });
  }
}
