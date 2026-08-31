import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '../../src/mikro-orm.config.js';
import {
  createSqsClient,
  getWagerQueueUrl,
} from '../../src/wagering/infrastructure/messaging/sqs-client.js';
import { WagerTransactionConsumer } from '../../src/wagering/infrastructure/messaging/wager-transaction.consumer.js';

const orm = await MikroORM.init(mikroOrmConfig);
const sqsClient = createSqsClient();

sqsClient.middlewareStack.add(
  (next, context) => async (args) => {
    if (context.commandName === 'DeleteMessageCommand') {
      process.exit(73);
    }

    return next(args);
  },
  { step: 'initialize', name: 'crashBeforeWagerAcknowledgement' },
);

const consumer = new WagerTransactionConsumer(
  orm.em,
  sqsClient,
  getWagerQueueUrl(),
  1,
);

await consumer.runOnce();
await orm.close(true);
sqsClient.destroy();
process.exit(2);
