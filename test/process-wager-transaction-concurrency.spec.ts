import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { randomUUID } from 'node:crypto';

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

const WALLET_ID = '00000000-0000-4000-8000-000000001001';
const PLAYER_ID = '00000000-0000-4000-8000-000000001002';
const FIRST_TRANSACTION_ID = '00000000-0000-4000-8000-000000001003';
const FIRST_LEDGER_ID = '00000000-0000-4000-8000-000000001004';
const SECOND_TRANSACTION_ID = '00000000-0000-4000-8000-000000001005';
const SECOND_LEDGER_ID = '00000000-0000-4000-8000-000000001006';

let orm: MikroORM;

function createInput(
  externalTransactionId: string,
  walletId = WALLET_ID,
  playerId = PLAYER_ID,
  amount = '80.00',
) {
  return {
    providerId: 'provider-concurrency',
    externalTransactionId,
    idempotencyKey: `provider-concurrency:${externalTransactionId}`,
    walletId,
    playerId,
    roundId: 'round-concurrency',
    gameId: 'game-concurrency',
    kind: WagerTransactionKind.Bet,
    money: Money.from({
      amount,
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

describe('ProcessWagerTransactionUseCase concurrency', () => {
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

  it('processes different wallets concurrently without a global lock', async () => {
    const secondWalletId = randomUUID();
    const secondPlayerId = randomUUID();
    await openWalletFixture(orm, secondWalletId, secondPlayerId);

    const results = await Promise.all([
      new ProcessWagerTransactionUseCase(orm.em.fork()).execute(
        createInput('parallel-wallet-one'),
      ),
      new ProcessWagerTransactionUseCase(orm.em.fork()).execute(
        createInput('parallel-wallet-two', secondWalletId, secondPlayerId),
      ),
    ]);
    const entityManager = orm.em.fork();
    const [firstWallet, secondWallet, firstLedger, secondLedger] =
      await Promise.all([
        entityManager.findOne(WalletOrmEntity, WALLET_ID),
        entityManager.findOne(WalletOrmEntity, secondWalletId),
        entityManager.find(WalletLedgerEntryOrmEntity, {
          walletId: WALLET_ID,
        }),
        entityManager.find(WalletLedgerEntryOrmEntity, {
          walletId: secondWalletId,
        }),
      ]);

    expect(
      results.every(
        (result) =>
          result.transaction.status === WagerTransactionStatus.Processed,
      ),
    ).toBe(true);
    expect(firstWallet?.balance).toBe('20.00');
    expect(secondWallet?.balance).toBe('20.00');
    expectWalletBalanceMatchesLedger(firstWallet, firstLedger);
    expectWalletBalanceMatchesLedger(secondWallet, secondLedger);
  });

  it('remains correct with four independent Bun processes', async () => {
    const operations = Array.from({ length: 4 }, (_, index) =>
      createInput(`multi-process-bet-${index}`, WALLET_ID, PLAYER_ID, '30.00'),
    );
    const children = operations.map((input) =>
      Bun.spawn(
        [
          'bun',
          'test/support/process-wager-child.ts',
          JSON.stringify({
            ...input,
            money: input.money.toJSON(),
          }),
        ],
        { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' },
      ),
    );
    const childResults = await Promise.all(
      children.map(async (child) => {
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);

        if (exitCode !== 0) {
          throw new Error(stderr);
        }

        return JSON.parse(stdout.trim()) as {
          transactionId: string;
          status: WagerTransactionStatus;
        };
      }),
    );
    const entityManager = orm.em.fork();
    const [wallet, transactions, ledgerEntries] = await Promise.all([
      entityManager.findOne(WalletOrmEntity, WALLET_ID),
      entityManager.find(WagerTransactionOrmEntity, {
        walletId: WALLET_ID,
        kind: WagerTransactionKind.Bet,
      }),
      entityManager.find(WalletLedgerEntryOrmEntity, { walletId: WALLET_ID }),
    ]);
    const debits = ledgerEntries.filter(
      (entry) => entry.direction === LedgerDirection.Debit,
    );

    expect(childResults).toHaveLength(4);
    expect(
      childResults.filter(
        (result) => result.status === WagerTransactionStatus.Processed,
      ),
    ).toHaveLength(3);
    expect(
      childResults.filter(
        (result) => result.status === WagerTransactionStatus.Rejected,
      ),
    ).toHaveLength(1);
    expect(
      new Set(childResults.map((result) => result.transactionId)).size,
    ).toBe(4);
    expect(transactions).toHaveLength(4);
    expect(debits).toHaveLength(3);
    expect(wallet?.balance).toBe('10.00');
    expectWalletBalanceMatchesLedger(wallet, ledgerEntries);
  });
});
