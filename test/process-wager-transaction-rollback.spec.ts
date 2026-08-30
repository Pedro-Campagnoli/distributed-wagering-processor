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

const WALLET_ID = '00000000-0000-4000-8000-000000001301';
const PLAYER_ID = '00000000-0000-4000-8000-000000001302';
const PROVIDER_ID = 'provider-rollback';
const ROUND_ID = 'round-rollback';

let orm: MikroORM;

function createInput(
  kind: WagerTransactionKind,
  externalTransactionId: string,
  amount = '25.00',
) {
  return {
    providerId: PROVIDER_ID,
    externalTransactionId,
    idempotencyKey: `${PROVIDER_ID}:${externalTransactionId}`,
    payloadHash: `hash:${externalTransactionId}`,
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: ROUND_ID,
    gameId: 'game-rollback',
    kind,
    money: Money.from({
      amount,
      currency: 'BRL',
    }),
  };
}

function createReversalInput(
  kind: WagerTransactionKind.Refund | WagerTransactionKind.Rollback,
  externalTransactionId: string,
  referenceExternalTransactionId: string,
  amount = '25.00',
) {
  return {
    ...createInput(kind, externalTransactionId, amount),
    referenceExternalTransactionId,
  };
}

function execute(
  input: ReturnType<typeof createInput> & {
    referenceExternalTransactionId?: string;
  },
) {
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

async function expectProcessedRollback(
  referenceKind: WagerTransactionKind.Bet | WagerTransactionKind.Win,
  expectedDirection: LedgerDirection,
) {
  const referenceExternalTransactionId = `reference-${referenceKind}`;
  const reference = await execute(
    createInput(referenceKind, referenceExternalTransactionId),
  );
  const rollback = await execute(
    createReversalInput(
      WagerTransactionKind.Rollback,
      `rollback-${referenceKind}`,
      referenceExternalTransactionId,
    ),
  );
  const state = await persistedState();
  const rollbackLedgerEntries = state.ledgerEntries.filter(
    (entry) => entry.transactionId === rollback.transaction.id,
  );

  expect(rollback.transaction.status).toBe(WagerTransactionStatus.Processed);
  expect(rollback.transaction.referenceTransactionId).toBe(
    reference.transaction.id,
  );
  expect(rollbackLedgerEntries).toHaveLength(1);
  expect(rollbackLedgerEntries[0]?.direction).toBe(expectedDirection);
  expect(rollbackLedgerEntries[0]?.amount).toBe('25.00');

  return state;
}

describe('ProcessWagerTransactionUseCase ROLLBACK', () => {
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

  it('credits the wallet when rolling back a BET', async () => {
    const state = await expectProcessedRollback(
      WagerTransactionKind.Bet,
      LedgerDirection.Credit,
    );

    expect(state.wallet?.balance).toBe('100.00');
  });

  it('debits the wallet when rolling back a WIN', async () => {
    const state = await expectProcessedRollback(
      WagerTransactionKind.Win,
      LedgerDirection.Debit,
    );

    expect(state.wallet?.balance).toBe('100.00');
  });

  it('debits the wallet when rolling back a REFUND', async () => {
    await execute(createInput(WagerTransactionKind.Bet, 'bet-refunded'));
    const refund = await execute(
      createReversalInput(
        WagerTransactionKind.Refund,
        'refund-reference',
        'bet-refunded',
      ),
    );
    const rollback = await execute(
      createReversalInput(
        WagerTransactionKind.Rollback,
        'rollback-refund',
        'refund-reference',
      ),
    );
    const state = await persistedState();
    const rollbackLedgerEntries = state.ledgerEntries.filter(
      (entry) => entry.transactionId === rollback.transaction.id,
    );

    expect(rollback.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(rollback.transaction.referenceTransactionId).toBe(
      refund.transaction.id,
    );
    expect(state.wallet?.balance).toBe('75.00');
    expect(rollbackLedgerEntries).toHaveLength(1);
    expect(rollbackLedgerEntries[0]?.direction).toBe(LedgerDirection.Debit);
  });

  it('rejects an invalid reference without financial effects', async () => {
    await execute(createInput(WagerTransactionKind.Loss, 'loss-reference'));

    const rollback = await execute(
      createReversalInput(
        WagerTransactionKind.Rollback,
        'rollback-loss',
        'loss-reference',
      ),
    );
    const state = await persistedState();

    expect(rollback.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(rollback.transaction.failureCode).toBe('INVALID_REFERENCE_KIND');
    expect(rollback.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.ledgerEntries).toHaveLength(1);
  });

  it('rejects an amount different from the reference without another effect', async () => {
    await execute(createInput(WagerTransactionKind.Bet, 'bet-other-amount'));

    const rollback = await execute(
      createReversalInput(
        WagerTransactionKind.Rollback,
        'rollback-other-amount',
        'bet-other-amount',
        '20.00',
      ),
    );
    const state = await persistedState();

    expect(rollback.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(rollback.transaction.failureCode).toBe('REFERENCE_AMOUNT_MISMATCH');
    expect(rollback.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('75.00');
    expect(state.ledgerEntries).toHaveLength(2);
  });

  it('rejects a second ROLLBACK without duplicating effects', async () => {
    await execute(createInput(WagerTransactionKind.Bet, 'bet-once'));
    await execute(
      createReversalInput(
        WagerTransactionKind.Rollback,
        'rollback-first',
        'bet-once',
      ),
    );

    const secondRollback = await execute(
      createReversalInput(
        WagerTransactionKind.Rollback,
        'rollback-second',
        'bet-once',
      ),
    );

    const state = await persistedState();
    const rollbacks = state.transactions.filter(
      (transaction) => transaction.kind === WagerTransactionKind.Rollback,
    );

    expect(secondRollback.transaction.status).toBe(
      WagerTransactionStatus.Rejected,
    );
    expect(secondRollback.transaction.failureCode).toBe(
      'REFERENCE_ALREADY_ROLLED_BACK',
    );
    expect(secondRollback.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('100.00');
    expect(rollbacks).toHaveLength(2);
    expect(state.ledgerEntries).toHaveLength(3);
  });

  it('allows a corrected ROLLBACK after a rejected attempt', async () => {
    await execute(createInput(WagerTransactionKind.Bet, 'bet-corrected'));

    const rejected = await execute(
      createReversalInput(
        WagerTransactionKind.Rollback,
        'rollback-invalid',
        'bet-corrected',
        '20.00',
      ),
    );
    const corrected = await execute(
      createReversalInput(
        WagerTransactionKind.Rollback,
        'rollback-corrected',
        'bet-corrected',
      ),
    );
    const state = await persistedState();
    const correctedLedgerEntries = state.ledgerEntries.filter(
      (entry) => entry.transactionId === corrected.transaction.id,
    );

    expect(rejected.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(corrected.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(state.wallet?.balance).toBe('100.00');
    expect(correctedLedgerEntries).toHaveLength(1);
    expect(correctedLedgerEntries[0]?.direction).toBe(LedgerDirection.Credit);
    expect(state.ledgerEntries).toHaveLength(3);
  });

  it('rejects a ROLLBACK that would make the balance negative', async () => {
    await execute(createInput(WagerTransactionKind.Win, 'win-spent'));
    await execute(
      createInput(WagerTransactionKind.Bet, 'bet-spend-win', '125.00'),
    );

    const rollback = await execute(
      createReversalInput(
        WagerTransactionKind.Rollback,
        'rollback-without-balance',
        'win-spent',
      ),
    );
    const state = await persistedState();

    expect(rollback.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(rollback.transaction.failureCode).toBe(
      'ROLLBACK_INSUFFICIENT_BALANCE',
    );
    expect(rollback.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('0.00');
    expect(state.ledgerEntries).toHaveLength(3);
  });
});
