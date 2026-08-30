import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { OpenWalletUseCase } from '../src/shared/application/use-cases/open-wallet.use-case.js';
import { Money } from '../src/shared/domain/money.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../src/shared/domain/wallet-ledger-entry.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../src/shared/domain/wager-transaction.js';
import { Wallet } from '../src/shared/domain/wallet.js';
import { MikroOrmWagerTransactionRepository } from '../src/shared/infrastructure/persistence/mikro-orm-wager-transaction.repository.js';
import { MikroOrmWalletLedgerEntryRepository } from '../src/shared/infrastructure/persistence/mikro-orm-wallet-ledger-entry.repository.js';
import { MikroOrmWalletRepository } from '../src/shared/infrastructure/persistence/mikro-orm-wallet.repository.js';
import mikroOrmConfig from '@/mikro-orm.config.js';

const OPEN_WALLET_TESTS_ENABLED = process.env.RUN_OPEN_WALLET_TESTS === '1';
const describeOpenWallet = OPEN_WALLET_TESTS_ENABLED ? describe : describe.skip;

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

interface WalletRow {
  id: string;
  balance: string;
  currency: string;
  version: number;
}

interface OpeningRow {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  roundId: string;
  gameId: string;
  kind: string;
  amount: string;
  currency: string;
  status: string;
  processedAt: string | null;
}

interface LedgerRow {
  id: string;
  direction: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
}

interface CountsRow {
  wallets: number;
  transactions: number;
  ledgerEntries: number;
}

let orm: MikroORM;

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

async function countsForWallet(walletId: string): Promise<CountsRow> {
  const [counts] = await orm.em.execute<CountsRow[]>(
    `
      select
        (select count(*)::int from wallets where id = ?) as wallets,
        (
          select count(*)::int
          from wager_transactions
          where wallet_id = ?
        ) as "transactions",
        (
          select count(*)::int
          from wallet_ledger_entries
          where wallet_id = ?
        ) as "ledgerEntries"
    `,
    [walletId, walletId, walletId],
  );

  if (!counts) {
    throw new Error('Expected PostgreSQL count result');
  }

  return counts;
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
  const walletRepository = new MikroOrmWalletRepository(orm.em);
  const wagerTransactionRepository = new MikroOrmWagerTransactionRepository(
    orm.em,
  );
  const walletLedgerEntryRepository = new MikroOrmWalletLedgerEntryRepository(
    orm.em,
  );
  const createdAt = new Date('2020-01-01T00:00:00.000Z');

  await walletRepository.insert(
    Wallet.rehydrate({
      id: EXISTING_WALLET_ID,
      playerId: EXISTING_PLAYER_ID,
      currency: 'BRL',
      balance: Money.from({ amount: '75.00', currency: 'BRL' }),
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
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
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
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '75.00', currency: 'BRL' }),
      createdAt,
    }),
  );
}

describeOpenWallet('OpenWalletUseCase', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
  });

  beforeEach(truncateTables);

  afterAll(async () => {
    await truncateTables();
    await orm.close(true);
  });

  it('persists only a version-one wallet when initial balance is zero', async () => {
    const useCase = new OpenWalletUseCase(orm.em);

    const wallet = await useCase.execute({
      playerId: PLAYER_ID,
      initialBalance: Money.zero('BRL'),
    });

    const [row] = await orm.em.execute<WalletRow[]>(
      `
        select
          id,
          balance::text as balance,
          currency,
          version
        from wallets
        where id = ?
      `,
      [wallet.id],
    );
    const counts = await countsForWallet(wallet.id);

    expect(wallet.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(wallet.balance.toJSON()).toEqual({
      amount: '0.00',
      currency: 'BRL',
    });
    expect(wallet.version).toBe(1);
    expect(row).toEqual({
      id: wallet.id,
      balance: '0.00',
      currency: 'BRL',
      version: 1,
    });
    expect(counts).toEqual({
      wallets: 1,
      transactions: 0,
      ledgerEntries: 0,
    });
  });

  it('persists a processed OPENING and CREDIT ledger for a positive balance', async () => {
    const useCase = new OpenWalletUseCase(
      orm.em,
      createIdGenerator(
        POSITIVE_WALLET_ID,
        OPENING_TRANSACTION_ID,
        OPENING_LEDGER_ID,
      ),
    );

    const wallet = await useCase.execute({
      playerId: PLAYER_ID,
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    const [walletRow] = await orm.em.execute<WalletRow[]>(
      `
        select
          id,
          balance::text as balance,
          currency,
          version
        from wallets
        where id = ?
      `,
      [wallet.id],
    );
    const [openingRow] = await orm.em.execute<OpeningRow[]>(
      `
        select
          id,
          provider_id as "providerId",
          external_transaction_id as "externalTransactionId",
          idempotency_key as "idempotencyKey",
          payload_hash as "payloadHash",
          round_id as "roundId",
          game_id as "gameId",
          kind,
          amount::text as amount,
          currency,
          status,
          processed_at as "processedAt"
        from wager_transactions
        where wallet_id = ?
      `,
      [wallet.id],
    );
    const [ledgerRow] = await orm.em.execute<LedgerRow[]>(
      `
        select
          id,
          direction,
          amount::text as amount,
          currency,
          balance_before::text as "balanceBefore",
          balance_after::text as "balanceAfter"
        from wallet_ledger_entries
        where wallet_id = ?
      `,
      [wallet.id],
    );
    const counts = await countsForWallet(wallet.id);

    expect(walletRow).toEqual({
      id: POSITIVE_WALLET_ID,
      balance: '100.00',
      currency: 'BRL',
      version: 1,
    });
    expect(openingRow).toEqual({
      id: OPENING_TRANSACTION_ID,
      providerId: 'SYSTEM',
      externalTransactionId: `opening:${POSITIVE_WALLET_ID}`,
      idempotencyKey: `SYSTEM:opening:${POSITIVE_WALLET_ID}`,
      payloadHash:
        '5b447485fe1b4f24b9f5b93ac8f9c69764a7efd0a8e7f136128da1c87ac0c6eb',
      roundId: `opening:${POSITIVE_WALLET_ID}`,
      gameId: 'SYSTEM',
      kind: 'OPENING',
      amount: '100.00',
      currency: 'BRL',
      status: 'PROCESSED',
      processedAt: expect.any(String),
    });
    expect(ledgerRow).toEqual({
      id: OPENING_LEDGER_ID,
      direction: 'CREDIT',
      amount: '100.00',
      currency: 'BRL',
      balanceBefore: '0.00',
      balanceAfter: '100.00',
    });
    expect(counts).toEqual({
      wallets: 1,
      transactions: 1,
      ledgerEntries: 1,
    });
  });

  it('rolls back wallet and OPENING when the ledger insert fails', async () => {
    await insertExistingLedgerFixture();
    const useCase = new OpenWalletUseCase(
      orm.em,
      createIdGenerator(
        ROLLBACK_WALLET_ID,
        ROLLBACK_TRANSACTION_ID,
        COLLIDING_LEDGER_ID,
      ),
    );

    await expectDatabaseError(
      useCase.execute({
        playerId: PLAYER_ID,
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      }),
      'wallet_ledger_entries_pkey',
    );

    expect(await countsForWallet(ROLLBACK_WALLET_ID)).toEqual({
      wallets: 0,
      transactions: 0,
      ledgerEntries: 0,
    });
  });

  it('lets PostgreSQL reject a duplicate player and currency', async () => {
    const firstUseCase = new OpenWalletUseCase(
      orm.em,
      createIdGenerator(
        '00000000-0000-4000-8000-000000000911',
        '00000000-0000-4000-8000-000000000912',
        '00000000-0000-4000-8000-000000000913',
      ),
    );
    const duplicateUseCase = new OpenWalletUseCase(
      orm.em,
      createIdGenerator('00000000-0000-4000-8000-000000000914'),
    );
    const input = {
      playerId: PLAYER_ID,
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    };

    const wallet = await firstUseCase.execute(input);

    await expectDatabaseError(
      duplicateUseCase.execute(input),
      'wallets_player_id_currency_unique',
    );

    expect(await countsForWallet(wallet.id)).toEqual({
      wallets: 1,
      transactions: 1,
      ledgerEntries: 1,
    });
  });
});
