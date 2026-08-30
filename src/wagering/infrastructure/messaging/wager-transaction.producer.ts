import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

import type { ProcessWagerTransactionInput } from '../../application/use-cases/process-wager-transaction.use-case.js';
import { createWagerTransactionMessage } from './wager-transaction.message.js';

export class WagerTransactionProducer {
  constructor(
    private readonly sqsClient: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async send(input: ProcessWagerTransactionInput): Promise<string> {
    const message = createWagerTransactionMessage(input);

    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: input.walletId,
        MessageDeduplicationId: message.messageId,
      }),
    );

    return message.messageId;
  }
}
