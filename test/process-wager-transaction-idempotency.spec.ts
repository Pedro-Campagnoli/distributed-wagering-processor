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
import { IdempotencyConflictError } from '../src/wagering/domain/errors.js';
import { Money } from '../src/wagering/domain/money.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../src/wagering/domain/wager-transaction.js';
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
import {
  expectWalletBalanceMatchesLedger,
  openWalletFixture,
} from './support/financial-fixture.js';

const WALLET_ID = '00000000-0000-4000-8000-000000001101';
const PLAYER_ID = '00000000-0000-4000-8000-000000001102';
const TRANSACTION_ID = '00000000-0000-4000-8000-000000001103';
const LEDGER_ID = '00000000-0000-4000-8000-000000001104';
const UNUSED_TRANSACTION_ID = '00000000-0000-4000-8000-000000001105';
const UNUSED_LEDGER_ID = '00000000-0000-4000-8000-000000001106';

let orm: MikroORM;

function createInput(payloadHash = 'payload-hash') {
  return {
    providerId: 'provider-idempotency',
    externalTransactionId: 'bet-idempotency',
    idempotencyKey: 'provider-idempotency:bet-idempotency',
    payloadHash,
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-idempotency',
    gameId: 'game-idempotency',
    kind: WagerTransactionKind.Bet,
    money: Money.from({
      amount: '25.00',
      currency: 'BRL',
    }),
  };
}

function createUseCase(
  transactionId: string,
  ledgerId: string,
): ProcessWagerTransactionUseCase {
  const ids = [transactionId, ledgerId];
  let index = 0;

  return new ProcessWagerTransactionUseCase(orm.em.fork(), () => {
    const id = ids[index++];

    if (!id) {
      throw new Error('No deterministic test id available');
    }

    return id;
  });
}

async function persistedState() {
  const entityManager = orm.em.fork();

  const [wallet, transactions, ledgerEntries] = await Promise.all([
    entityManager.findOne(WalletOrmEntity, WALLET_ID),
    entityManager.find(WagerTransactionOrmEntity, {
      walletId: WALLET_ID,
    }),
    entityManager.find(WalletLedgerEntryOrmEntity, {
      walletId: WALLET_ID,
    }),
  ]);

  expectWalletBalanceMatchesLedger(wallet, ledgerEntries);

  return {
    wallet,
    transactions,
    ledgerEntries,
  };
}

describe('ProcessWagerTransactionUseCase idempotency', () => {
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

  it('processes the first request normally', async () => {
    const result = await createUseCase(TRANSACTION_ID, LEDGER_ID).execute(
      createInput(),
    );
    const state = await persistedState();

    expect(result.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(result.observedBalance?.toJSON().amount).toBe('75.00');
    expect(state.wallet?.balance).toBe('75.00');
    expect(state.transactions).toHaveLength(2);
    expect(
      state.transactions.find(
        (transaction) => transaction.id === TRANSACTION_ID,
      )?.observedBalance,
    ).toBe('75.00');
    expect(state.ledgerEntries).toHaveLength(2);
  });

  it('does not apply another financial effect for the same key and payload', async () => {
    await createUseCase(TRANSACTION_ID, LEDGER_ID).execute(createInput());

    const replay = await createUseCase(
      UNUSED_TRANSACTION_ID,
      UNUSED_LEDGER_ID,
    ).execute(createInput());
    const state = await persistedState();

    expect(replay.transaction.id).toBe(TRANSACTION_ID);
    expect(replay.observedBalance?.toJSON().amount).toBe('75.00');
    expect(replay.wallet).toBeUndefined();
    expect(replay.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('75.00');
    expect(state.transactions).toHaveLength(2);
    expect(state.ledgerEntries).toHaveLength(2);
  });

  it('returns the original observed balance after the wallet balance changes', async () => {
    await createUseCase(TRANSACTION_ID, LEDGER_ID).execute(createInput());

    await new ProcessWagerTransactionUseCase(orm.em.fork()).execute({
      ...createInput(),
      externalTransactionId: 'win-after-bet',
      idempotencyKey: 'provider-idempotency:win-after-bet',
      payloadHash: 'hash:win-after-bet',
      kind: WagerTransactionKind.Win,
      money: Money.from({
        amount: '10.00',
        currency: 'BRL',
      }),
    });

    const replay = await createUseCase(
      UNUSED_TRANSACTION_ID,
      UNUSED_LEDGER_ID,
    ).execute(createInput());
    const state = await persistedState();

    expect(replay.observedBalance?.toJSON().amount).toBe('75.00');
    expect(replay.wallet).toBeUndefined();
    expect(state.wallet?.balance).toBe('85.00');
    expect(state.transactions).toHaveLength(3);
    expect(state.ledgerEntries).toHaveLength(3);
  });

  it('rejects a wallet currency mismatch without financial effects', async () => {
    const result = await createUseCase(TRANSACTION_ID, LEDGER_ID).execute({
      ...createInput(),
      money: Money.from({
        amount: '25.00',
        currency: 'USD',
      }),
    });
    const state = await persistedState();

    expect(result.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.transaction.failureCode).toBe('CURRENCY_MISMATCH');
    expect(result.ledgerEntry).toBeUndefined();
    expect(result.observedBalance?.toJSON().amount).toBe('100.00');
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.transactions).toHaveLength(2);
    expect(state.ledgerEntries).toHaveLength(1);
  });

  it('applies a single financial effect for 50 concurrent identical requests', async () => {
    const input = createInput();
    const operations = Array.from({ length: 50 }, () =>
      new ProcessWagerTransactionUseCase(orm.em.fork()).execute(input),
    );

    const responses = await Promise.all(operations);
    const state = await persistedState();
    const transactionIds = new Set(
      responses.map((response) => response.transaction.id),
    );
    const observedBalances = new Set(
      responses.map((response) => response.observedBalance?.toJSON().amount),
    );

    expect(responses).toHaveLength(50);
    expect(transactionIds.size).toBe(1);
    expect(observedBalances).toEqual(new Set(['75.00']));
    expect(
      responses.every(
        (response) =>
          response.transaction.idempotencyKey === input.idempotencyKey &&
          response.transaction.payloadHash === input.payloadHash,
      ),
    ).toBe(true);
    const wagerTransaction = state.transactions.find(
      (transaction) => transaction.kind === WagerTransactionKind.Bet,
    );
    const wagerLedger = state.ledgerEntries.find(
      (entry) => entry.transactionId === wagerTransaction?.id,
    );

    expect(state.transactions).toHaveLength(2);
    expect(wagerTransaction?.id).toBe(responses[0]?.transaction.id);
    expect(wagerTransaction?.observedBalance).toBe('75.00');
    expect(state.ledgerEntries).toHaveLength(2);
    expect(wagerLedger?.amount).toBe('25.00');
    expect(wagerLedger?.balanceBefore).toBe('100.00');
    expect(wagerLedger?.balanceAfter).toBe('75.00');
    expect(state.wallet?.balance).toBe('75.00');
  });

  it('rejects the same key with a different payload hash as a conflict', async () => {
    await createUseCase(TRANSACTION_ID, LEDGER_ID).execute(createInput());

    const conflictingRequest = createUseCase(
      UNUSED_TRANSACTION_ID,
      UNUSED_LEDGER_ID,
    ).execute(createInput('different-payload-hash'));

    await expect(conflictingRequest).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );

    const state = await persistedState();

    expect(state.wallet?.balance).toBe('75.00');
    expect(state.transactions).toHaveLength(2);
    expect(state.ledgerEntries).toHaveLength(2);
  });
});
