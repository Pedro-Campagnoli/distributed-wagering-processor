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
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
import {
  expectWalletBalanceMatchesLedger,
  openWalletFixture,
} from './support/financial-fixture.js';

const WALLET_ID = '00000000-0000-4000-8000-000000001401';
const PLAYER_ID = '00000000-0000-4000-8000-000000001402';
const PROVIDER_ID = 'provider-pending-reference';

let orm: MikroORM;

function createInput(
  kind: WagerTransactionKind,
  externalTransactionId: string,
  referenceExternalTransactionId?: string,
) {
  return {
    providerId: PROVIDER_ID,
    externalTransactionId,
    idempotencyKey: `${PROVIDER_ID}:${externalTransactionId}`,
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-pending-reference',
    gameId: 'game-pending-reference',
    kind,
    money: Money.from({
      amount: '25.00',
      currency: 'BRL',
    }),
    referenceExternalTransactionId,
  };
}

function execute(input: ReturnType<typeof createInput>) {
  return new ProcessWagerTransactionUseCase(orm.em.fork()).execute(input);
}

async function persistedState() {
  const entityManager = orm.em.fork();

  const [wallet, transactions, ledgerEntries] = await Promise.all([
    entityManager.findOne(WalletOrmEntity, WALLET_ID),
    entityManager.find(WagerTransactionOrmEntity, { walletId: WALLET_ID }),
    entityManager.find(WalletLedgerEntryOrmEntity, { walletId: WALLET_ID }),
  ]);

  expectWalletBalanceMatchesLedger(wallet, ledgerEntries);

  return {
    wallet,
    transactions,
    ledgerEntries,
  };
}

describe('ProcessWagerTransactionUseCase PENDING_REFERENCE', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
  });

  beforeEach(async () => {
    await orm.schema.clear({ truncate: true });

    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
  });

  afterAll(async () => {
    await orm.schema.clear({ truncate: true });
    await orm.close(true);
  });

  it('persists REFUND as PENDING_REFERENCE without financial effects', async () => {
    const result = await execute(
      createInput(WagerTransactionKind.Refund, 'refund-pending', 'missing-bet'),
    );
    const state = await persistedState();

    expect(result.transaction.status).toBe(
      WagerTransactionStatus.PendingReference,
    );
    expect(result.transaction.failureCode).toBeUndefined();
    expect(result.transaction.referenceTransactionId).toBeUndefined();
    expect(result.ledgerEntry).toBeUndefined();
    expect(result.observedBalance?.toJSON().amount).toBe('100.00');
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.transactions).toHaveLength(2);
    expect(
      state.transactions.find(
        (transaction) => transaction.kind === WagerTransactionKind.Refund,
      )?.status,
    ).toBe(WagerTransactionStatus.PendingReference);
    const pending = state.transactions.find(
      (transaction) => transaction.kind === WagerTransactionKind.Refund,
    );
    expect(pending?.referenceExternalTransactionId).toBe('missing-bet');
    expect(pending?.failureCode).toBeNull();
    expect(state.ledgerEntries).toHaveLength(1);
  });

  it('persists ROLLBACK as PENDING_REFERENCE without financial effects', async () => {
    const result = await execute(
      createInput(
        WagerTransactionKind.Rollback,
        'rollback-pending',
        'missing-transaction',
      ),
    );
    const state = await persistedState();

    expect(result.transaction.status).toBe(
      WagerTransactionStatus.PendingReference,
    );
    expect(result.transaction.failureCode).toBeUndefined();
    expect(result.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.transactions).toHaveLength(2);
    expect(
      state.transactions.find(
        (transaction) => transaction.kind === WagerTransactionKind.Rollback,
      )?.status,
    ).toBe(WagerTransactionStatus.PendingReference);
    expect(state.ledgerEntries).toHaveLength(1);
  });

  it('replays a pending operation without creating duplicates', async () => {
    const input = createInput(
      WagerTransactionKind.Refund,
      'refund-replay',
      'missing-bet-replay',
    );
    const first = await execute(input);
    const replay = await execute(input);
    const state = await persistedState();

    expect(replay.transaction.id).toBe(first.transaction.id);
    expect(replay.transaction.status).toBe(
      WagerTransactionStatus.PendingReference,
    );
    expect(replay.observedBalance?.toJSON().amount).toBe('100.00');
    expect(replay.wallet).toBeUndefined();
    expect(replay.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.transactions).toHaveLength(2);
    expect(state.ledgerEntries).toHaveLength(1);
  });

  it('keeps normal processing when the reference already exists', async () => {
    await execute(createInput(WagerTransactionKind.Bet, 'existing-bet'));

    const refund = await execute(
      createInput(
        WagerTransactionKind.Refund,
        'refund-existing-bet',
        'existing-bet',
      ),
    );
    const state = await persistedState();

    expect(refund.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(refund.transaction.referenceTransactionId).toBeDefined();
    expect(refund.ledgerEntry).toBeDefined();
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.transactions).toHaveLength(3);
    expect(state.ledgerEntries).toHaveLength(3);
  });
});
