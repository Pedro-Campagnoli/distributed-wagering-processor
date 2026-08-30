import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '@/mikro-orm.config.js';

import { ProcessWagerTransactionUseCase } from '../src/wagering/application/use-cases/process-wager-transaction.use-case.js';
import { Money } from '../src/wagering/domain/money.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../src/wagering/domain/wager-transaction.js';
import { LedgerDirection } from '../src/wagering/domain/wallet-ledger-entry.js';
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
import {
  expectWalletBalanceMatchesLedger,
  openWalletFixture,
} from './support/financial-fixture.js';

const DATABASE_TESTS_ENABLED = process.env.RUN_DATABASE_TESTS === '1';
const describeWithDatabase = DATABASE_TESTS_ENABLED ? describe : describe.skip;

const WALLET_ID = '00000000-0000-4000-8000-000000001001';
const PLAYER_ID = '00000000-0000-4000-8000-000000001002';
const FIRST_TRANSACTION_ID = '00000000-0000-4000-8000-000000001003';
const FIRST_LEDGER_ID = '00000000-0000-4000-8000-000000001004';
const SECOND_TRANSACTION_ID = '00000000-0000-4000-8000-000000001005';
const SECOND_LEDGER_ID = '00000000-0000-4000-8000-000000001006';

let orm: MikroORM;

function createInput(externalTransactionId: string) {
  return {
    providerId: 'provider-concurrency',
    externalTransactionId,
    idempotencyKey: `provider-concurrency:${externalTransactionId}`,
    payloadHash: `hash:${externalTransactionId}`,
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-concurrency',
    gameId: 'game-concurrency',
    kind: WagerTransactionKind.Bet,
    money: Money.from({
      amount: '80.00',
      currency: 'BRL',
    }),
  };
}

function createIdGenerator(...ids: string[]): () => string {
  let index = 0;

  return () => {
    const id = ids[index++];

    if (!id) {
      throw new Error('No deterministic test id available');
    }

    return id;
  };
}

describeWithDatabase('ProcessWagerTransactionUseCase concurrency', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
  });

  beforeEach(async () => {
    await orm.schema.clear({
      truncate: true,
    });

    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
  });

  afterAll(async () => {
    await orm.schema.clear({
      truncate: true,
    });

    await orm.close(true);
  });

  it('processes only one of two concurrent BET 80 operations on a wallet with balance 100', async () => {
    const firstUseCase = new ProcessWagerTransactionUseCase(
      orm.em.fork(),
      createIdGenerator(FIRST_TRANSACTION_ID, FIRST_LEDGER_ID),
    );
    const secondUseCase = new ProcessWagerTransactionUseCase(
      orm.em.fork(),
      createIdGenerator(SECOND_TRANSACTION_ID, SECOND_LEDGER_ID),
    );

    await Promise.all([
      firstUseCase.execute(createInput('bet-concurrent-1')),
      secondUseCase.execute(createInput('bet-concurrent-2')),
    ]);

    const verificationEntityManager = orm.em.fork();
    const wallet = await verificationEntityManager.findOne(
      WalletOrmEntity,
      WALLET_ID,
    );
    const transactions = await verificationEntityManager.find(
      WagerTransactionOrmEntity,
      {
        walletId: WALLET_ID,
        kind: WagerTransactionKind.Bet,
      },
    );
    const ledgerEntries = await verificationEntityManager.find(
      WalletLedgerEntryOrmEntity,
      { walletId: WALLET_ID },
    );
    const debitLedgerEntries = ledgerEntries.filter(
      (entry) => entry.direction === LedgerDirection.Debit,
    );

    expectWalletBalanceMatchesLedger(wallet, ledgerEntries);

    expect(transactions).toHaveLength(2);
    expect(
      transactions.filter(
        (transaction) =>
          transaction.status === WagerTransactionStatus.Processed,
      ),
    ).toHaveLength(1);
    expect(
      transactions.filter(
        (transaction) =>
          transaction.status === WagerTransactionStatus.Rejected &&
          transaction.failureCode === 'INSUFFICIENT_BALANCE',
      ),
    ).toHaveLength(1);
    expect(wallet?.balance).toBe('20.00');
    expect(Number(wallet?.balance)).toBeGreaterThanOrEqual(0);
    expect(debitLedgerEntries).toHaveLength(1);
    expect(debitLedgerEntries[0]?.amount).toBe('80.00');
    expect(debitLedgerEntries[0]?.balanceBefore).toBe('100.00');
    expect(debitLedgerEntries[0]?.balanceAfter).toBe('20.00');
  });
});
