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
import { Wallet } from '../src/wagering/domain/wallet.js';
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
import { MikroOrmWalletRepository } from '../src/wagering/infrastructure/persistence/repositories/mikro-orm-wallet.repository.js';

const DATABASE_TESTS_ENABLED = process.env.RUN_DATABASE_TESTS === '1';
const describeWithDatabase = DATABASE_TESTS_ENABLED ? describe : describe.skip;

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

  return {
    wallet,
    transactions,
    ledgerEntries,
  };
}

describeWithDatabase('ProcessWagerTransactionUseCase idempotency', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
  });

  beforeEach(async () => {
    await orm.schema.clear({
      truncate: true,
    });

    const walletRepository = new MikroOrmWalletRepository(orm.em.fork());

    await walletRepository.insert(
      Wallet.open({
        id: WALLET_ID,
        playerId: PLAYER_ID,
        initialBalance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
      }),
    );
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
    expect(state.wallet?.balance).toBe('75.00');
    expect(state.transactions).toHaveLength(1);
    expect(state.ledgerEntries).toHaveLength(1);
  });

  it('does not apply another financial effect for the same key and payload', async () => {
    await createUseCase(TRANSACTION_ID, LEDGER_ID).execute(createInput());

    const replay = await createUseCase(
      UNUSED_TRANSACTION_ID,
      UNUSED_LEDGER_ID,
    ).execute(createInput());
    const state = await persistedState();

    expect(replay.transaction.id).toBe(TRANSACTION_ID);
    expect(replay.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('75.00');
    expect(state.transactions).toHaveLength(1);
    expect(state.ledgerEntries).toHaveLength(1);
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
    expect(state.transactions).toHaveLength(1);
    expect(state.ledgerEntries).toHaveLength(1);
  });
});
