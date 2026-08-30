import { SQSClient } from '@aws-sdk/client-sqs';

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_ENDPOINT = 'http://localhost:4566';
const DEFAULT_ACCOUNT_ID = '000000000000';

export function createSqsClient(): SQSClient {
  return new SQSClient({
    endpoint: process.env.SQS_ENDPOINT ?? DEFAULT_ENDPOINT,
    region:
      process.env.AWS_REGION ??
      process.env.AWS_DEFAULT_REGION ??
      DEFAULT_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  });
}

export function getWagerQueueUrl(): string {
  const endpoint = process.env.SQS_ENDPOINT ?? DEFAULT_ENDPOINT;
  const region =
    process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? DEFAULT_REGION;

  return (
    process.env.SQS_WAGER_QUEUE_URL ??
    `${endpoint}/queue/${region}/${DEFAULT_ACCOUNT_ID}/wager-transactions.fifo`
  );
}

export function getWagerDlqUrl(): string {
  const endpoint = process.env.SQS_ENDPOINT ?? DEFAULT_ENDPOINT;
  const region =
    process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? DEFAULT_REGION;

  return (
    process.env.SQS_WAGER_DLQ_URL ??
    `${endpoint}/queue/${region}/${DEFAULT_ACCOUNT_ID}/wager-transactions-dlq.fifo`
  );
}
