import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '../../src/mikro-orm.config.js';
import {
  createSqsClient,
  getWagerEventsQueueUrl,
} from '../../src/wagering/infrastructure/messaging/sqs-client.js';
import { OutboxPublisherWorker } from '../../src/wagering/infrastructure/workers/outbox-publisher.worker.js';

const orm = await MikroORM.init(mikroOrmConfig);
const sqsClient = createSqsClient();

sqsClient.middlewareStack.add(
  (next, context) => async (args) => {
    if (context.commandName === 'SendMessageCommand') {
      process.exit(74);
    }

    return next(args);
  },
  { step: 'initialize', name: 'crashBeforeOutboxSend' },
);

const publisher = new OutboxPublisherWorker(
  orm.em,
  sqsClient,
  getWagerEventsQueueUrl(),
  1,
);

await publisher.runOnce();
await orm.close(true);
sqsClient.destroy();
process.exit(2);
