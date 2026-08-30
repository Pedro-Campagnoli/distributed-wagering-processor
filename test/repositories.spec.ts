import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '../mikro-orm.config.js';
import { Money } from '../src/shared/domain/money.js';
import {
  LedgerDirection,
  type LedgerEntryState,
  WalletLedgerEntry,
} from '../src/shared/domain/wallet-ledger-entry.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type WagerTransactionState,
} from '../src/shared/domain/wager-transaction.js';
import { Wallet, type WalletState } from '../src/shared/domain/wallet.js';
import { MikroOrmWagerTransactionRepository } from '../src/shared/infrastructure/persistence/mikro-orm-wager-transaction.repository.js';
import { MikroOrmWalletLedgerEntryRepository } from '../src/shared/infrastructure/persistence/mikro-orm-wallet-ledger-entry.repository.js';
import { MikroOrmWalletRepository } from '../src/shared/infrastructure/persistence/mikro-orm-wallet.repository.js';

const REPOSITORY_TESTS_ENABLED = process.env.RUN_REPOSITORY_TESTS === '1';
const describeRepositories = REPOSITORY_TESTS_ENABLED
  ? describe
  : describe.skip;

const WALLET_ID = '00000000-0000-4000-8000-000000000501';
const PLAYER_ID = '00000000-0000-4000-8000-000000000601';
const TRANSACTION_ID = '00000000-0000-4000-8000-000000000701';
const LEDGER_ENTRY_ID = '00000000-0000-4000-8000-000000000801';
const CREATED_AT = new Date('2020-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2020-01-02T00:00:00.000Z');
const PROCESSED_AT = new Date('2020-01-03T00:00:00.000Z');

interface LedgerRow {
  id: string;
  walletId: string;
  transactionId: string;
  direction: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  createdAt: string;
}

let orm: MikroORM;
let walletRepository: MikroOrmWalletRepository;
let wagerTransactionRepository: MikroOrmWagerTransactionRepository;
let walletLedgerEntryRepository: MikroOrmWalletLedgerEntryRepository;

function makeWallet(overrides: Partial<WalletState> = {}): Wallet {
  return Wallet.rehydrate({
    id: WALLET_ID,
    playerId: PLAYER_ID,
    currency: 'BRL',
    balance: Money.from({ amount: '100.00', currency: 'BRL' }),
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  });
}

function makeTransaction(
  overrides: Partial<WagerTransactionState> = {},
): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: TRANSACTION_ID,
    providerId: 'provider-1',
    externalTransactionId: 'external-1',
    idempotencyKey: 'idempotency-1',
    payloadHash: 'hash-1',
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    createdAt: CREATED_AT,
    status: WagerTransactionStatus.Pending,
    ...overrides,
  });
}

function makeLedgerEntry(
  overrides: Partial<LedgerEntryState> = {},
): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate({
    id: LEDGER_ENTRY_ID,
    walletId: WALLET_ID,
    transactionId: TRANSACTION_ID,
    direction: LedgerDirection.Debit,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
    balanceAfter: Money.from({ amount: '75.00', currency: 'BRL' }),
    createdAt: CREATED_AT,
    ...overrides,
  });
}

async function truncateTables(): Promise<void> {
  await orm.em.execute(`
    truncate table
      outbox_messages,
      inbox_messages,
      wallet_ledger_entries,
      wager_transactions,
      wallets
    cascade
  `);
}

describeRepositories('PostgreSQL repositories', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    walletRepository = new MikroOrmWalletRepository(orm.em);
    wagerTransactionRepository = new MikroOrmWagerTransactionRepository(orm.em);
    walletLedgerEntryRepository = new MikroOrmWalletLedgerEntryRepository(
      orm.em,
    );
  });

  beforeEach(truncateTables);

  afterAll(async () => {
    await truncateTables();
    await orm.close(true);
  });

  describe('WalletRepository', () => {
    it('inserts and finds a wallet by id with exact money and persisted state', async () => {
      const wallet = makeWallet({
        balance: Money.from({
          amount: '999999999999999999.99',
          currency: 'BRL',
        }),
        version: 7,
      });

      await walletRepository.insert(wallet);

      const found = await walletRepository.findById(wallet.id);

      expect(found).toBeInstanceOf(Wallet);
      expect(found?.id).toBe(wallet.id);
      expect(found?.playerId).toBe(wallet.playerId);
      expect(found?.currency).toBe('BRL');
      expect(found?.balance.toJSON()).toEqual({
        amount: '999999999999999999.99',
        currency: 'BRL',
      });
      expect(found?.version).toBe(7);
      expect(found?.createdAt).toEqual(CREATED_AT);
      expect(found?.updatedAt).toEqual(UPDATED_AT);
    });

    it('finds a wallet by player and currency', async () => {
      const wallet = makeWallet();
      await walletRepository.insert(wallet);

      const found = await walletRepository.findByPlayerAndCurrency(
        wallet.playerId,
        wallet.currency,
      );

      expect(found?.id).toBe(wallet.id);
    });

    it('returns undefined when a wallet does not exist', async () => {
      const found = await walletRepository.findById(WALLET_ID);

      expect(found).toBeUndefined();
    });
  });

  describe('WagerTransactionRepository', () => {
    beforeEach(async () => {
      await walletRepository.insert(makeWallet());
    });

    it('inserts and finds a terminal transaction by id without rerunning creation rules', async () => {
      const transaction = makeTransaction({
        money: Money.from({ amount: '123456789012345678.90', currency: 'BRL' }),
        status: WagerTransactionStatus.Failed,
        failureCode: 'PROVIDER_TIMEOUT',
      });

      await wagerTransactionRepository.insert(transaction);

      const found = await wagerTransactionRepository.findById(transaction.id);

      expect(found).toBeInstanceOf(WagerTransaction);
      expect(found?.id).toBe(transaction.id);
      expect(found?.money.toJSON()).toEqual({
        amount: '123456789012345678.90',
        currency: 'BRL',
      });
      expect(found?.status).toBe(WagerTransactionStatus.Failed);
      expect(found?.failureCode).toBe('PROVIDER_TIMEOUT');
      expect(found?.referenceExternalTransactionId).toBeUndefined();
      expect(found?.referenceTransactionId).toBeUndefined();
      expect(found?.processedAt).toBeUndefined();
      expect(found?.createdAt).toEqual(CREATED_AT);
    });

    it('finds a PENDING_REFERENCE transaction by provider identity', async () => {
      const transaction = makeTransaction({
        kind: WagerTransactionKind.Refund,
        status: WagerTransactionStatus.PendingReference,
        referenceExternalTransactionId: 'original-external-1',
      });
      await wagerTransactionRepository.insert(transaction);

      const found =
        await wagerTransactionRepository.findByProviderAndExternalTransactionId(
          transaction.providerId,
          transaction.externalTransactionId,
        );

      expect(found?.id).toBe(transaction.id);
      expect(found?.kind).toBe(WagerTransactionKind.Refund);
      expect(found?.status).toBe(WagerTransactionStatus.PendingReference);
      expect(found?.referenceExternalTransactionId).toBe('original-external-1');
      expect(found?.referenceTransactionId).toBeUndefined();
      expect(found?.failureCode).toBeUndefined();
      expect(found?.processedAt).toBeUndefined();
    });

    it('finds a processed transaction by idempotency key', async () => {
      const transaction = makeTransaction({
        status: WagerTransactionStatus.Processed,
        processedAt: PROCESSED_AT,
      });
      await wagerTransactionRepository.insert(transaction);

      const found = await wagerTransactionRepository.findByIdempotencyKey(
        transaction.idempotencyKey,
      );

      expect(found?.id).toBe(transaction.id);
      expect(found?.status).toBe(WagerTransactionStatus.Processed);
      expect(found?.failureCode).toBeUndefined();
      expect(found?.processedAt).toEqual(PROCESSED_AT);
    });

    it('returns undefined when a transaction does not exist', async () => {
      const found = await wagerTransactionRepository.findById(TRANSACTION_ID);

      expect(found).toBeUndefined();
    });
  });

  describe('WalletLedgerEntryRepository', () => {
    it('inserts a valid entry preserving exact financial values and timestamps', async () => {
      await walletRepository.insert(makeWallet());
      await wagerTransactionRepository.insert(makeTransaction());

      const entry = makeLedgerEntry();
      await walletLedgerEntryRepository.insert(entry);

      const [row] = await orm.em.execute<LedgerRow[]>(
        `
          select
            id,
            wallet_id as "walletId",
            transaction_id as "transactionId",
            direction,
            amount::text as amount,
            currency,
            balance_before::text as "balanceBefore",
            balance_after::text as "balanceAfter",
            created_at as "createdAt"
          from wallet_ledger_entries
          where id = ?
        `,
        [entry.id],
      );

      expect(row).toEqual({
        id: LEDGER_ENTRY_ID,
        walletId: WALLET_ID,
        transactionId: TRANSACTION_ID,
        direction: 'DEBIT',
        amount: '25.00',
        currency: 'BRL',
        balanceBefore: '100.00',
        balanceAfter: '75.00',
        createdAt: '2020-01-01 00:00:00+00',
      });
    });
  });
});
