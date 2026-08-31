import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '../../src/mikro-orm.config.js';
import { ProcessWagerTransactionUseCase } from '../../src/wagering/application/use-cases/process-wager-transaction.use-case.js';
import { Money } from '../../src/wagering/domain/money.js';
import type { WagerTransactionKind } from '../../src/wagering/domain/wager-transaction.js';

interface ChildInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: { amount: string; currency: string };
}

const serializedInput = process.argv[2];

if (!serializedInput) {
  throw new Error('Missing child wager input');
}

const input = JSON.parse(serializedInput) as ChildInput;
const orm = await MikroORM.init(mikroOrmConfig);

try {
  const result = await new ProcessWagerTransactionUseCase(orm.em).execute({
    ...input,
    money: Money.from(input.money),
  });

  console.log(
    JSON.stringify({
      transactionId: result.transaction.id,
      status: result.transaction.status,
    }),
  );
} finally {
  await orm.close(true);
}
