import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { type EntityManager, MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '@/mikro-orm.config.js';

import { OpenWalletUseCase } from '../src/wagering/application/use-cases/open-wallet.use-case.js';

import { Money } from '../src/wagering/domain/money.js';

import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../src/wagering/domain/wallet-ledger-entry.js';

import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../src/wagering/domain/wager-transaction.js';

import { Wallet } from '../src/wagering/domain/wallet.js';

import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';

import { MikroOrmWagerTransactionRepository } from '../src/wagering/infrastructure/persistence/repositories/mikro-orm-wager-transaction.repository.js';

import { MikroOrmWalletLedgerEntryRepository } from '../src/wagering/infrastructure/persistence/repositories/mikro-orm-wallet-ledger-entry.repository.js';

import { MikroOrmWalletRepository } from '../src/wagering/infrastructure/persistence/repositories/mikro-orm-wallet.repository.js';

const PLAYER_ID = '00000000-0000-4000-8000-000000000901';

const POSITIVE_WALLET_ID = '00000000-0000-4000-8000-000000000902';

const OPENING_TRANSACTION_ID = '00000000-0000-4000-8000-000000000903';

const OPENING_LEDGER_ID = '00000000-0000-4000-8000-000000000904';

const EXISTING_WALLET_ID = '00000000-0000-4000-8000-000000000905';

const EXISTING_PLAYER_ID = '00000000-0000-4000-8000-000000000906';

const EXISTING_TRANSACTION_ID = '00000000-0000-4000-8000-000000000907';

const COLLIDING_LEDGER_ID = '00000000-0000-4000-8000-000000000908';

const ROLLBACK_WALLET_ID = '00000000-0000-4000-8000-000000000909';

const ROLLBACK_TRANSACTION_ID = '00000000-0000-4000-8000-000000000910';

let orm: MikroORM;
let em: EntityManager;

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

async function clearDatabase(): Promise<void> {
  await orm.schema.clear({
    truncate: true,
  });
}

async function countsForWallet(walletId: string): Promise<{
  wallets: number;
  transactions: number;
  ledgerEntries: number;
}> {
  const [wallets, transactions, ledgerEntries] = await Promise.all([
    em.count(WalletOrmEntity, {
      id: walletId,
    }),

    em.count(WagerTransactionOrmEntity, {
      walletId,
    }),

    em.count(WalletLedgerEntryOrmEntity, {
      walletId,
    }),
  ]);

  return {
    wallets,
    transactions,
    ledgerEntries,
  };
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  expectedConstraint: string,
): Promise<void> {
  let caught: unknown;

  try {
    await operation;
  } catch (error) {
    caught = error;
  }

  if (!(caught instanceof Error)) {
    throw new Error('Expected PostgreSQL to reject the operation');
  }

  expect(caught.message).toContain(expectedConstraint);
}

async function insertExistingLedgerFixture(): Promise<void> {
  const walletRepository = new MikroOrmWalletRepository(em);

  const wagerTransactionRepository = new MikroOrmWagerTransactionRepository(em);

  const walletLedgerEntryRepository = new MikroOrmWalletLedgerEntryRepository(
    em,
  );

  const createdAt = new Date('2020-01-01T00:00:00.000Z');

  await walletRepository.insert(
    Wallet.rehydrate({
      id: EXISTING_WALLET_ID,
      playerId: EXISTING_PLAYER_ID,
      currency: 'BRL',
      balance: Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
      version: 2,
      createdAt,
      updatedAt: createdAt,
    }),
  );

  await wagerTransactionRepository.insert(
    WagerTransaction.rehydrate({
      id: EXISTING_TRANSACTION_ID,
      providerId: 'provider-existing',
      externalTransactionId: 'external-existing',
      idempotencyKey: 'idempotency-existing',
      payloadHash: 'hash-existing',
      walletId: EXISTING_WALLET_ID,
      playerId: EXISTING_PLAYER_ID,
      roundId: 'round-existing',
      gameId: 'game-existing',
      kind: WagerTransactionKind.Bet,
      money: Money.from({
        amount: '25.00',
        currency: 'BRL',
      }),
      createdAt,
      status: WagerTransactionStatus.Processed,
      processedAt: createdAt,
    }),
  );

  await walletLedgerEntryRepository.insert(
    WalletLedgerEntry.rehydrate({
      id: COLLIDING_LEDGER_ID,
      walletId: EXISTING_WALLET_ID,
      transactionId: EXISTING_TRANSACTION_ID,
      direction: LedgerDirection.Debit,
      money: Money.from({
        amount: '25.00',
        currency: 'BRL',
      }),
      balanceBefore: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      balanceAfter: Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
      createdAt,
    }),
  );

  em.clear();
}

describe('OpenWalletUseCase', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
  });

  beforeEach(async () => {
    await clearDatabase();

    em = orm.em.fork();
  });

  afterAll(async () => {
    await clearDatabase();

    await orm.close(true);
  });

  it('persists only a version-one wallet when initial balance is zero', async () => {
    const useCase = new OpenWalletUseCase(em);

    const wallet = await useCase.execute({
      playerId: PLAYER_ID,
      initialBalance: Money.zero('BRL'),
    });

    em.clear();

    const walletEntity = await em.findOne(WalletOrmEntity, wallet.id);

    const counts = await countsForWallet(wallet.id);

    expect(wallet.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    expect(wallet.balance.toJSON()).toEqual({
      amount: '0.00',
      currency: 'BRL',
    });

    expect(wallet.version).toBe(1);

    expect(walletEntity).toBeDefined();

    expect(walletEntity?.id).toBe(wallet.id);

    expect(walletEntity?.balance).toBe('0.00');

    expect(walletEntity?.currency).toBe('BRL');

    expect(walletEntity?.version).toBe(1);

    expect(counts).toEqual({
      wallets: 1,
      transactions: 0,
      ledgerEntries: 0,
    });
  });

  it('persists a processed OPENING and CREDIT ledger for a positive balance', async () => {
    const useCase = new OpenWalletUseCase(
      em,
      createIdGenerator(
        POSITIVE_WALLET_ID,
        OPENING_TRANSACTION_ID,
        OPENING_LEDGER_ID,
      ),
    );

    const wallet = await useCase.execute({
      playerId: PLAYER_ID,
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
    });

    em.clear();

    const walletEntity = await em.findOne(WalletOrmEntity, wallet.id);

    const openingEntity = await em.findOne(
      WagerTransactionOrmEntity,
      OPENING_TRANSACTION_ID,
    );

    const ledgerEntity = await em.findOne(
      WalletLedgerEntryOrmEntity,
      OPENING_LEDGER_ID,
    );

    const counts = await countsForWallet(wallet.id);

    expect(walletEntity).toBeDefined();

    expect(walletEntity?.id).toBe(POSITIVE_WALLET_ID);

    expect(walletEntity?.balance).toBe('100.00');

    expect(walletEntity?.currency).toBe('BRL');

    expect(walletEntity?.version).toBe(1);

    expect(openingEntity).toBeDefined();

    expect(openingEntity?.id).toBe(OPENING_TRANSACTION_ID);

    expect(openingEntity?.providerId).toBe('SYSTEM');

    expect(openingEntity?.externalTransactionId).toBe(
      `opening:${POSITIVE_WALLET_ID}`,
    );

    expect(openingEntity?.idempotencyKey).toBe(
      `SYSTEM:opening:${POSITIVE_WALLET_ID}`,
    );

    expect(openingEntity?.payloadHash).toBe(
      '5b447485fe1b4f24b9f5b93ac8f9c69764a7efd0a8e7f136128da1c87ac0c6eb',
    );

    expect(openingEntity?.roundId).toBe(`opening:${POSITIVE_WALLET_ID}`);

    expect(openingEntity?.gameId).toBe('SYSTEM');

    expect(openingEntity?.kind).toBe('OPENING');

    expect(openingEntity?.amount).toBe('100.00');

    expect(openingEntity?.currency).toBe('BRL');

    expect(openingEntity?.status).toBe('PROCESSED');

    expect(openingEntity?.processedAt).toBeInstanceOf(Date);

    expect(ledgerEntity).toBeDefined();

    expect(ledgerEntity?.id).toBe(OPENING_LEDGER_ID);

    expect(ledgerEntity?.direction).toBe(LedgerDirection.Credit);

    expect(ledgerEntity?.amount).toBe('100.00');

    expect(ledgerEntity?.currency).toBe('BRL');

    expect(ledgerEntity?.balanceBefore).toBe('0.00');

    expect(ledgerEntity?.balanceAfter).toBe('100.00');

    expect(counts).toEqual({
      wallets: 1,
      transactions: 1,
      ledgerEntries: 1,
    });
  });

  it('rolls back wallet and OPENING when the ledger insert fails', async () => {
    await insertExistingLedgerFixture();

    const useCase = new OpenWalletUseCase(
      em,
      createIdGenerator(
        ROLLBACK_WALLET_ID,
        ROLLBACK_TRANSACTION_ID,
        COLLIDING_LEDGER_ID,
      ),
    );

    await expectDatabaseError(
      useCase.execute({
        playerId: PLAYER_ID,
        initialBalance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
      }),
      'wallet_ledger_entries_pkey',
    );

    em.clear();

    expect(await countsForWallet(ROLLBACK_WALLET_ID)).toEqual({
      wallets: 0,
      transactions: 0,
      ledgerEntries: 0,
    });
  });

  it('lets PostgreSQL reject a duplicate player and currency', async () => {
    const firstUseCase = new OpenWalletUseCase(
      em,
      createIdGenerator(
        '00000000-0000-4000-8000-000000000911',
        '00000000-0000-4000-8000-000000000912',
        '00000000-0000-4000-8000-000000000913',
      ),
    );

    const duplicateUseCase = new OpenWalletUseCase(
      em,
      createIdGenerator('00000000-0000-4000-8000-000000000914'),
    );

    const input = {
      playerId: PLAYER_ID,
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
    };

    const wallet = await firstUseCase.execute(input);

    await expectDatabaseError(
      duplicateUseCase.execute(input),
      'wallets_player_id_currency_unique',
    );

    em.clear();

    expect(await countsForWallet(wallet.id)).toEqual({
      wallets: 1,
      transactions: 1,
      ledgerEntries: 1,
    });
  });
});
