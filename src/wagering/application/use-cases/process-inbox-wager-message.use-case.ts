import { createHash } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';

import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionOutput,
} from './process-wager-transaction.use-case.js';
import { Money } from '../../domain/money.js';
import { InboxMessageOrmEntity } from '../../infrastructure/persistence/entities/inbox-message.orm-entity.js';
import { MikroOrmInboxMessageRepository } from '../../infrastructure/persistence/repositories/mikro-orm-inbox-message.repository.js';
import type { WagerTransactionMessage } from '../../infrastructure/messaging/wager-transaction.producer.js';

export interface ProcessInboxWagerMessageInput {
  consumerName: string;
  messageId: string;
  body: string;
}

export interface ProcessInboxWagerMessageOutput {
  alreadyProcessed: boolean;
  result?: ProcessWagerTransactionOutput;
}

export class ProcessInboxWagerMessageUseCase {
  constructor(private readonly entityManager: EntityManager) {}

  execute(
    input: ProcessInboxWagerMessageInput,
  ): Promise<ProcessInboxWagerMessageOutput> {
    const payload = JSON.parse(input.body) as WagerTransactionMessage;
    const payloadHash = createHash('sha256').update(input.body).digest('hex');

    return this.entityManager.fork().transactional(async (tx) => {
      const inboxRepository = new MikroOrmInboxMessageRepository(tx);
      let inboxMessage = await inboxRepository.find(
        input.consumerName,
        input.messageId,
      );

      if (inboxMessage?.processedAt) {
        return { alreadyProcessed: true };
      }

      if (inboxMessage && inboxMessage.payloadHash !== payloadHash) {
        throw new Error('Inbox message payload hash mismatch');
      }

      if (!inboxMessage) {
        inboxMessage = new InboxMessageOrmEntity();
        inboxMessage.consumerName = input.consumerName;
        inboxMessage.messageId = input.messageId;
        inboxMessage.payloadHash = payloadHash;
        inboxMessage.receivedAt = new Date();
        inboxMessage.processedAt = null;

        await inboxRepository.insert(inboxMessage);
      }

      const result = await new ProcessWagerTransactionUseCase(tx).execute({
        ...payload,
        money: Money.from(payload.money),
      });

      await inboxRepository.markProcessed(inboxMessage, new Date());

      return {
        alreadyProcessed: false,
        result,
      };
    });
  }
}
