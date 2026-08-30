import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

import type { ProcessWagerTransactionInput } from '../../application/use-cases/process-wager-transaction.use-case.js';

export interface WagerTransactionMessage {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: ProcessWagerTransactionInput['kind'];
  money: {
    amount: string;
    currency: string;
  };
  referenceExternalTransactionId?: string;
}

export class WagerTransactionProducer {
  constructor(
    private readonly sqsClient: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async send(input: ProcessWagerTransactionInput): Promise<string | undefined> {
    const message: WagerTransactionMessage = {
      ...input,
      money: input.money.toJSON(),
    };

    const response = await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: input.walletId,
      }),
    );

    return response.MessageId;
  }
}
