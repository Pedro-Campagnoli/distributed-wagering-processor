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

const DATABASE_TESTS_ENABLED = process.env.RUN_DATABASE_TESTS === '1';
const describeDatabase = DATABASE_TESTS_ENABLED ? describe : describe.skip;

const CREATED_AT = '2020-01-01T00:00:00.000Z';
const WALLET_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const PLAYER_ID = '00000000-0000-4000-8000-000000000101';
const TRANSACTION_ID = '00000000-0000-4000-8000-000000000201';
const SECOND_TRANSACTION_ID = '00000000-0000-4000-8000-000000000202';
const LEDGER_ENTRY_ID = '00000000-0000-4000-8000-000000000301';
const SECOND_LEDGER_ENTRY_ID = '00000000-0000-4000-8000-000000000302';
const OUTBOX_MESSAGE_ID = '00000000-0000-4000-8000-000000000401';

interface WalletRow {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
}

interface WagerTransactionRow {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  amount: string;
  currency: string;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  status: string;
  failureCode: string | null;
  processedAt: string | null;
  observedBalance: string | null;
}

interface WalletLedgerEntryRow {
  id: string;
  walletId: string;
  transactionId: string;
  direction: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
}

interface OutboxMessageRow {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: string;
  attempts: number;
}

let orm: MikroORM;

function execute(sql: string, params: unknown[] = []): Promise<unknown> {
  return orm.em.getConnection().execute(sql, params);
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  let caught: unknown;

  try {
    await operation;
  } catch (error) {
    caught = error;
  }

  if (!(caught instanceof Error)) {
    throw new Error('Expected PostgreSQL to reject the statement');
  }

  expect(caught.message).toContain(expectedMessage);
}

function insertWallet(overrides: Partial<WalletRow> = {}): Promise<unknown> {
  const row: WalletRow = {
    id: WALLET_ID,
    playerId: PLAYER_ID,
    currency: 'BRL',
    balance: '100.00',
    version: 1,
    ...overrides,
  };

  return execute(
    `
      insert into wallets (
        id,
        player_id,
        currency,
        balance,
        version,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.id,
      row.playerId,
      row.currency,
      row.balance,
      row.version,
      CREATED_AT,
      CREATED_AT,
    ],
  );
}

function insertTransaction(
  overrides: Partial<WagerTransactionRow> = {},
): Promise<unknown> {
  const row: WagerTransactionRow = {
    id: TRANSACTION_ID,
    providerId: 'provider-1',
    externalTransactionId: 'external-1',
    idempotencyKey: 'idempotency-1',
    payloadHash: 'hash-1',
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    amount: '25.00',
    currency: 'BRL',
    referenceExternalTransactionId: null,
    referenceTransactionId: null,
    status: 'PENDING',
    failureCode: null,
    processedAt: null,
    observedBalance: null,
    ...overrides,
  };

  return execute(
    `
      insert into wager_transactions (
        id,
        provider_id,
        external_transaction_id,
        idempotency_key,
        payload_hash,
        wallet_id,
        player_id,
        round_id,
        game_id,
        kind,
        amount,
        currency,
        reference_external_transaction_id,
        reference_transaction_id,
        status,
        failure_code,
        created_at,
        processed_at,
        observed_balance
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.id,
      row.providerId,
      row.externalTransactionId,
      row.idempotencyKey,
      row.payloadHash,
      row.walletId,
      row.playerId,
      row.roundId,
      row.gameId,
      row.kind,
      row.amount,
      row.currency,
      row.referenceExternalTransactionId,
      row.referenceTransactionId,
      row.status,
      row.failureCode,
      CREATED_AT,
      row.processedAt,
      row.observedBalance,
    ],
  );
}

function insertLedgerEntry(
  overrides: Partial<WalletLedgerEntryRow> = {},
): Promise<unknown> {
  const row: WalletLedgerEntryRow = {
    id: LEDGER_ENTRY_ID,
    walletId: WALLET_ID,
    transactionId: TRANSACTION_ID,
    direction: 'DEBIT',
    amount: '25.00',
    currency: 'BRL',
    balanceBefore: '100.00',
    balanceAfter: '75.00',
    ...overrides,
  };

  return execute(
    `
      insert into wallet_ledger_entries (
        id,
        wallet_id,
        transaction_id,
        direction,
        amount,
        currency,
        balance_before,
        balance_after,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.id,
      row.walletId,
      row.transactionId,
      row.direction,
      row.amount,
      row.currency,
      row.balanceBefore,
      row.balanceAfter,
      CREATED_AT,
    ],
  );
}

function insertOutboxMessage(
  overrides: Partial<OutboxMessageRow> = {},
): Promise<unknown> {
  const row: OutboxMessageRow = {
    id: OUTBOX_MESSAGE_ID,
    aggregateId: WALLET_ID,
    eventType: 'wallet.updated',
    payload: '{"walletId":"wallet-1"}',
    attempts: 0,
    ...overrides,
  };

  return execute(
    `
      insert into outbox_messages (
        id,
        aggregate_id,
        event_type,
        payload,
        occurred_at,
        attempts,
        next_attempt_at,
        published_at
      ) values (?, ?, ?, ?, ?, ?, null, null)
    `,
    [
      row.id,
      row.aggregateId,
      row.eventType,
      row.payload,
      CREATED_AT,
      row.attempts,
    ],
  );
}

describeDatabase('PostgreSQL database invariants', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
  });

  beforeEach(async () => {
    await execute(`
      truncate table
        outbox_messages,
        inbox_messages,
        wallet_ledger_entries,
        wager_transactions,
        wallets
      cascade
    `);
  });

  afterAll(async () => {
    await execute(`
      truncate table
        outbox_messages,
        inbox_messages,
        wallet_ledger_entries,
        wager_transactions,
        wallets
      cascade
    `);
    await orm.close(true);
  });

  it('accepts valid rows and preserves observed balance exactly', async () => {
    await insertWallet();
    await insertTransaction({
      status: 'PROCESSED',
      processedAt: CREATED_AT,
      observedBalance: '75.00',
    });
    await insertLedgerEntry();
    await insertTransaction({
      id: SECOND_TRANSACTION_ID,
      externalTransactionId: 'refund-1',
      idempotencyKey: 'idempotency-refund-1',
      kind: 'REFUND',
      referenceExternalTransactionId: 'external-1',
      status: 'PENDING_REFERENCE',
    });
    await insertTransaction({
      id: '00000000-0000-4000-8000-000000000203',
      externalTransactionId: 'rollback-1',
      idempotencyKey: 'idempotency-rollback-1',
      kind: 'ROLLBACK',
      referenceExternalTransactionId: 'external-1',
      status: 'PENDING_REFERENCE',
    });
    await insertTransaction({
      id: '00000000-0000-4000-8000-000000000204',
      externalTransactionId: 'win-1',
      idempotencyKey: 'idempotency-win-1',
      kind: 'WIN',
      amount: '0.00',
      referenceExternalTransactionId: 'optional-reference',
    });
    await execute(
      `
        insert into inbox_messages (
          message_id,
          consumer_name,
          payload_hash,
          received_at,
          processed_at
        ) values (?, ?, ?, ?, null)
      `,
      ['message-1', 'wager-consumer', 'hash-1', CREATED_AT],
    );
    await insertOutboxMessage();

    const rows = (await execute(
      'select observed_balance from wager_transactions where id = ?',
      [TRANSACTION_ID],
    )) as Array<{ observed_balance: string }>;

    expect(rows[0]?.observed_balance).toBe('75.00');
  });

  describe('wallets', () => {
    it('rejects duplicate player and currency', async () => {
      await insertWallet();

      await expectDatabaseError(
        insertWallet({ id: SECOND_WALLET_ID }),
        'wallets_player_id_currency_unique',
      );
    });

    it.each([
      [
        'negative balance',
        { balance: '-0.01' },
        'wallets_balance_non_negative_check',
      ],
      ['version below one', { version: 0 }, 'wallets_version_positive_check'],
      [
        'invalid currency',
        { currency: 'brl' },
        'wallets_currency_format_check',
      ],
    ] as const)('rejects %s', async (_name, overrides, constraint) => {
      await expectDatabaseError(insertWallet(overrides), constraint);
    });
  });

  describe('wager_transactions', () => {
    beforeEach(async () => {
      await insertWallet();
    });

    it.each([
      ['invalid kind', { kind: 'INVALID' }, 'wager_transactions_kind_check'],
      [
        'invalid status',
        { status: 'INVALID' },
        'wager_transactions_status_check',
      ],
      [
        'negative amount',
        { amount: '-0.01' },
        'wager_transactions_amount_non_negative_check',
      ],
      [
        'negative observed balance',
        { observedBalance: '-0.01' },
        'wager_transactions_observed_balance_non_negative_check',
      ],
      [
        'invalid currency',
        { currency: 'brl' },
        'wager_transactions_currency_format_check',
      ],
    ] as const)('rejects %s', async (_name, overrides, constraint) => {
      await expectDatabaseError(insertTransaction(overrides), constraint);
    });

    it('rejects duplicate idempotency keys', async () => {
      await insertTransaction();

      await expectDatabaseError(
        insertTransaction({
          id: SECOND_TRANSACTION_ID,
          externalTransactionId: 'external-2',
        }),
        'wager_transactions_idempotency_key_unique',
      );
    });

    it('rejects duplicate provider transaction identities', async () => {
      await insertTransaction();

      await expectDatabaseError(
        insertTransaction({
          id: SECOND_TRANSACTION_ID,
          idempotencyKey: 'idempotency-2',
        }),
        'wager_transactions_provider_external_id_unique',
      );
    });

    it.each(['REFUND', 'ROLLBACK'] as const)(
      'rejects %s without an external reference',
      async (kind) => {
        await expectDatabaseError(
          insertTransaction({ kind }),
          'wager_transactions_reference_required_check',
        );
      },
    );

    it('rejects PENDING_REFERENCE for a kind without required reference', async () => {
      await expectDatabaseError(
        insertTransaction({ status: 'PENDING_REFERENCE' }),
        'wager_transactions_pending_reference_kind_check',
      );
    });

    it('rejects duplicate same-type reversals for one provider reference', async () => {
      await insertTransaction({
        externalTransactionId: 'refund-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'external-bet-1',
        status: 'PROCESSED',
        processedAt: CREATED_AT,
      });

      await expectDatabaseError(
        insertTransaction({
          id: SECOND_TRANSACTION_ID,
          externalTransactionId: 'refund-2',
          idempotencyKey: 'idempotency-2',
          kind: 'REFUND',
          referenceExternalTransactionId: 'external-bet-1',
          status: 'PROCESSED',
          processedAt: CREATED_AT,
        }),
        'wager_transactions_reversal_once_idx',
      );
    });

    it('allows a corrected reversal after a rejected attempt', async () => {
      await insertTransaction({
        externalTransactionId: 'refund-rejected',
        kind: 'REFUND',
        referenceExternalTransactionId: 'external-bet-1',
        status: 'REJECTED',
        failureCode: 'REFERENCE_AMOUNT_MISMATCH',
      });

      await insertTransaction({
        id: SECOND_TRANSACTION_ID,
        externalTransactionId: 'refund-corrected',
        idempotencyKey: 'idempotency-2',
        kind: 'REFUND',
        referenceExternalTransactionId: 'external-bet-1',
        status: 'PROCESSED',
        processedAt: CREATED_AT,
      });
    });
  });

  describe('wallet_ledger_entries', () => {
    beforeEach(async () => {
      await insertWallet();
      await insertTransaction();
    });

    it('rejects duplicate wallet and transaction entries', async () => {
      await insertLedgerEntry();

      await expectDatabaseError(
        insertLedgerEntry({ id: SECOND_LEDGER_ENTRY_ID }),
        'wallet_ledger_entries_wallet_transaction_unique',
      );
    });

    it.each([
      [
        'zero amount',
        { amount: '0.00', balanceAfter: '100.00' },
        'wallet_ledger_entries_amount_positive_check',
      ],
      [
        'negative amount',
        { amount: '-1.00', balanceAfter: '101.00' },
        'wallet_ledger_entries_amount_positive_check',
      ],
      [
        'invalid direction',
        { direction: 'INVALID' },
        'wallet_ledger_entries_direction_check',
      ],
      [
        'invalid currency',
        { currency: 'brl' },
        'wallet_ledger_entries_currency_format_check',
      ],
      [
        'negative balance before',
        {
          direction: 'CREDIT',
          amount: '1.00',
          balanceBefore: '-1.00',
          balanceAfter: '0.00',
        },
        'wallet_ledger_entries_balance_before_non_negative_check',
      ],
      [
        'negative balance after',
        { amount: '1.00', balanceBefore: '0.00', balanceAfter: '-1.00' },
        'wallet_ledger_entries_balance_after_non_negative_check',
      ],
      [
        'incorrect credit arithmetic',
        { direction: 'CREDIT', balanceAfter: '80.00' },
        'wallet_ledger_entries_balance_transition_check',
      ],
      [
        'incorrect debit arithmetic',
        { balanceAfter: '80.00' },
        'wallet_ledger_entries_balance_transition_check',
      ],
    ] as const)('rejects %s', async (_name, overrides, constraint) => {
      await expectDatabaseError(insertLedgerEntry(overrides), constraint);
    });

    it('rejects updates to existing entries', async () => {
      await insertLedgerEntry();

      await expectDatabaseError(
        execute('update wallet_ledger_entries set amount = ? where id = ?', [
          '30.00',
          LEDGER_ENTRY_ID,
        ]),
        'wallet_ledger_entries are immutable',
      );
    });

    it('rejects deletion of existing entries', async () => {
      await insertLedgerEntry();

      await expectDatabaseError(
        execute('delete from wallet_ledger_entries where id = ?', [
          LEDGER_ENTRY_ID,
        ]),
        'wallet_ledger_entries are immutable',
      );
    });
  });

  describe('outbox_messages', () => {
    it('rejects negative attempts', async () => {
      await expectDatabaseError(
        insertOutboxMessage({ attempts: -1 }),
        'outbox_messages_attempts_non_negative_check',
      );
    });
  });
});
