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
import { DuplicateRefundError } from '../src/wagering/domain/errors.js';
import { Money } from '../src/wagering/domain/money.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../src/wagering/domain/wager-transaction.js';
import { LedgerDirection } from '../src/wagering/domain/wallet-ledger-entry.js';
import { Wallet } from '../src/wagering/domain/wallet.js';
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
import { MikroOrmWalletRepository } from '../src/wagering/infrastructure/persistence/repositories/mikro-orm-wallet.repository.js';

const DATABASE_TESTS_ENABLED = process.env.RUN_DATABASE_TESTS === '1';
const describeWithDatabase = DATABASE_TESTS_ENABLED ? describe : describe.skip;

const WALLET_ID = '00000000-0000-4000-8000-000000001201';
const PLAYER_ID = '00000000-0000-4000-8000-000000001202';
const PROVIDER_ID = 'provider-refund';
const ROUND_ID = 'round-refund';

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
    gameId: 'game-refund',
    kind,
    money: Money.from({
      amount,
      currency: 'BRL',
    }),
  };
}

function createRefundInput(
  externalTransactionId: string,
  referenceExternalTransactionId: string,
  amount = '25.00',
) {
  return {
    ...createInput(WagerTransactionKind.Refund, externalTransactionId, amount),
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

  return {
    wallet,
    transactions,
    ledgerEntries,
  };
}

describeWithDatabase('ProcessWagerTransactionUseCase REFUND', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
  });

  beforeEach(async () => {
    await orm.schema.clear({ truncate: true });

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
    await orm.schema.clear({ truncate: true });
    await orm.close(true);
  });

  it('credits the wallet and creates one CREDIT ledger for a valid REFUND', async () => {
    const bet = await execute(
      createInput(WagerTransactionKind.Bet, 'bet-valid'),
    );
    const refund = await execute(
      createRefundInput('refund-valid', 'bet-valid'),
    );
    const state = await persistedState();
    const refundLedgerEntries = state.ledgerEntries.filter(
      (entry) => entry.transactionId === refund.transaction.id,
    );

    expect(refund.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(refund.transaction.referenceTransactionId).toBe(bet.transaction.id);
    expect(refund.observedBalance?.toJSON().amount).toBe('100.00');
    expect(state.wallet?.balance).toBe('100.00');
    expect(refundLedgerEntries).toHaveLength(1);
    expect(refundLedgerEntries[0]?.direction).toBe(LedgerDirection.Credit);
    expect(refundLedgerEntries[0]?.amount).toBe('25.00');
    expect(refundLedgerEntries[0]?.balanceBefore).toBe('75.00');
    expect(refundLedgerEntries[0]?.balanceAfter).toBe('100.00');
  });

  it('rejects a reference that is not a BET without financial effects', async () => {
    await execute(createInput(WagerTransactionKind.Loss, 'loss-reference'));

    const refund = await execute(
      createRefundInput('refund-loss', 'loss-reference'),
    );
    const state = await persistedState();

    expect(refund.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.transaction.failureCode).toBe('INVALID_REFERENCE_KIND');
    expect(refund.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.ledgerEntries).toHaveLength(0);
  });

  it('rejects a reference with incompatible data without another financial effect', async () => {
    await execute(createInput(WagerTransactionKind.Bet, 'bet-other-round'));

    const refund = await execute({
      ...createRefundInput('refund-other-round', 'bet-other-round'),
      roundId: 'another-round',
    });
    const state = await persistedState();

    expect(refund.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.transaction.failureCode).toBe('REFERENCE_DATA_MISMATCH');
    expect(refund.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('75.00');
    expect(state.ledgerEntries).toHaveLength(1);
    expect(state.ledgerEntries[0]?.direction).toBe(LedgerDirection.Debit);
  });

  it('rejects an amount different from the BET without another financial effect', async () => {
    await execute(createInput(WagerTransactionKind.Bet, 'bet-other-amount'));

    const refund = await execute(
      createRefundInput('refund-other-amount', 'bet-other-amount', '20.00'),
    );
    const state = await persistedState();

    expect(refund.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.transaction.failureCode).toBe('REFERENCE_AMOUNT_MISMATCH');
    expect(refund.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('75.00');
    expect(state.ledgerEntries).toHaveLength(1);
    expect(state.ledgerEntries[0]?.direction).toBe(LedgerDirection.Debit);
  });

  it('rejects a BET that was not processed without financial effects', async () => {
    await execute(
      createInput(WagerTransactionKind.Bet, 'bet-rejected', '125.00'),
    );

    const refund = await execute(
      createRefundInput('refund-rejected-bet', 'bet-rejected', '125.00'),
    );
    const state = await persistedState();

    expect(refund.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.transaction.failureCode).toBe('REFERENCE_NOT_PROCESSED');
    expect(refund.ledgerEntry).toBeUndefined();
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.ledgerEntries).toHaveLength(0);
  });

  it('rejects a second REFUND for the same BET without duplicating effects', async () => {
    await execute(createInput(WagerTransactionKind.Bet, 'bet-once'));
    await execute(createRefundInput('refund-first', 'bet-once'));

    const secondRefund = execute(
      createRefundInput('refund-second', 'bet-once'),
    );

    await expect(secondRefund).rejects.toBeInstanceOf(DuplicateRefundError);

    const state = await persistedState();
    const refunds = state.transactions.filter(
      (transaction) => transaction.kind === WagerTransactionKind.Refund,
    );
    const creditLedgerEntries = state.ledgerEntries.filter(
      (entry) => entry.direction === LedgerDirection.Credit,
    );

    expect(state.wallet?.balance).toBe('100.00');
    expect(refunds).toHaveLength(1);
    expect(creditLedgerEntries).toHaveLength(1);
    expect(state.ledgerEntries).toHaveLength(2);
  });
});
