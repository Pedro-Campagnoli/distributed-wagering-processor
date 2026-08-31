import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProcessWagerTransactionUseCase } from '../src/wagering/application/use-cases/process-wager-transaction.use-case.js';
import { WageringQueryService } from '../src/wagering/application/services/wagering-query.service.js';
import { Money } from '../src/wagering/domain/money.js';
import { WagerTransactionKind } from '../src/wagering/domain/wager-transaction.js';
import { operationalMetrics } from '../src/wagering/infrastructure/observability/operational-metrics.js';
import { MikroOrmWalletLedgerEntryRepository } from '../src/wagering/infrastructure/persistence/repositories/mikro-orm-wallet-ledger-entry.repository.js';
import { GlobalExceptionFilter } from '../src/wagering/presentation/http/filters/global-exception.filter.js';

describe('Checkpoint 4 HTTP API', () => {
  let app: INestApplication;
  let orm: MikroORM;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    orm = app.get(MikroORM);
  });

  beforeEach(async () => {
    await orm.schema.clear({ truncate: true });
    operationalMetrics.reset();
  });

  afterAll(async () => {
    await orm.schema.clear({ truncate: true });
    await app.close();
  });

  it('reports separate liveness and PostgreSQL/SQS readiness', async () => {
    const live = await request(app.getHttpServer()).get('/health/live');
    const ready = await request(app.getHttpServer()).get('/health/ready');

    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: 'ok' });
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({
      status: 'ok',
      checks: { postgres: 'up', sqs: 'up' },
    });
  });

  it('processes, replays and queries a wager with an opaque ledger cursor', async () => {
    const playerId = randomUUID();
    const walletResponse = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });
    const walletId = walletResponse.body.id as string;
    const externalTransactionId = `http-bet-${randomUUID()}`;
    const idempotencyKey = `provider-http:${externalTransactionId}`;
    const payload = {
      providerId: 'provider-http',
      externalTransactionId,
      playerId,
      walletId,
      roundId: 'round-http',
      gameId: 'game-http',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    };

    const processed = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', idempotencyKey)
      .set('X-Correlation-Id', 'correlation-http-test')
      .send(payload);
    const replay = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    const transactionId = processed.body.transactionId as string;
    const [byId, byProvider, wallet, firstLedgerPage, reconciliation] =
      await Promise.all([
        request(app.getHttpServer()).get(
          `/wagering/transactions/${transactionId}`,
        ),
        request(app.getHttpServer()).get(
          `/providers/provider-http/wagering/transactions/${externalTransactionId}`,
        ),
        request(app.getHttpServer()).get(`/wallets/${walletId}`),
        request(app.getHttpServer()).get(`/wallets/${walletId}/ledger?limit=1`),
        request(app.getHttpServer()).post(
          `/wallets/${walletId}/reconciliation`,
        ),
      ]);
    const secondLedgerPage = await request(app.getHttpServer()).get(
      `/wallets/${walletId}/ledger?limit=1&cursor=${encodeURIComponent(firstLedgerPage.body.nextCursor as string)}`,
    );
    const metrics = await request(app.getHttpServer()).get('/metrics');

    expect(processed.status).toBe(201);
    expect(processed.body).toEqual({
      transactionId: expect.any(String),
      status: 'PROCESSED',
      balance: { amount: '75.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({
      ...processed.body,
      idempotentReplay: true,
    });
    expect(byId.status).toBe(200);
    expect(byId.body.transactionId).toBe(transactionId);
    expect(byProvider.status).toBe(200);
    expect(byProvider.body.transactionId).toBe(transactionId);
    expect(wallet.status).toBe(200);
    expect(wallet.body.balance.amount).toBe('75.00');
    expect(firstLedgerPage.body.entries).toHaveLength(1);
    expect(firstLedgerPage.body.nextCursor).toEqual(expect.any(String));
    expect(secondLedgerPage.body.entries).toHaveLength(1);
    expect(secondLedgerPage.body.nextCursor).toBeUndefined();
    expect(reconciliation.body).toEqual({
      walletId,
      storedBalance: { amount: '75.00', currency: 'BRL' },
      calculatedBalance: { amount: '75.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 2,
    });
    expect(metrics.body.transactionsByStatus.PROCESSED).toBe(2);
    expect(metrics.body.duplicates).toBe(1);
    expect(metrics.body.processingLatencyMs.count).toBe(2);
  });

  it('distinguishes invalid input, idempotency conflict, rejection and pending acceptance', async () => {
    const playerId = randomUUID();
    const wallet = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });
    const walletId = wallet.body.id as string;
    const basePayload = {
      providerId: 'provider-http-errors',
      externalTransactionId: `http-errors-${randomUUID()}`,
      playerId,
      walletId,
      roundId: 'round-http-errors',
      gameId: 'game-http-errors',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    };
    const missingHeader = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .send(basePayload);
    const first = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-http-errors:shared-key')
      .send(basePayload);
    const conflict = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-http-errors:shared-key')
      .send({
        ...basePayload,
        money: { amount: '30.00', currency: 'BRL' },
      });
    const rejected = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `provider-http-errors:rejected-${randomUUID()}`)
      .send({
        ...basePayload,
        externalTransactionId: `rejected-${randomUUID()}`,
        money: { amount: '500.00', currency: 'BRL' },
      });
    const pending = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `provider-http-errors:pending-${randomUUID()}`)
      .send({
        ...basePayload,
        externalTransactionId: `pending-${randomUUID()}`,
        kind: 'REFUND',
        referenceExternalTransactionId: 'missing-bet',
      });
    const finalWallet = await request(app.getHttpServer()).get(
      `/wallets/${walletId}`,
    );
    const invalidCursor = await request(app.getHttpServer()).get(
      `/wallets/${walletId}/ledger?cursor=not-a-cursor`,
    );
    const missingTransaction = await request(app.getHttpServer()).get(
      `/wagering/transactions/${randomUUID()}`,
    );
    const metrics = await request(app.getHttpServer()).get('/metrics');

    expect(missingHeader.status).toBe(400);
    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(rejected.status).toBe(422);
    expect(rejected.body.status).toBe('REJECTED');
    expect(pending.status).toBe(202);
    expect(pending.body.status).toBe('PENDING_REFERENCE');
    expect(finalWallet.body.balance.amount).toBe('75.00');
    expect(invalidCursor.status).toBe(400);
    expect(missingTransaction.status).toBe(404);
    expect(metrics.body.duplicates).toBe(1);
    expect(metrics.body.transactionsByStatus).toEqual({
      PROCESSED: 1,
      REJECTED: 1,
      PENDING_REFERENCE: 1,
    });
  });

  it('exposes the required minimum operational metrics', async () => {
    const response = await request(app.getHttpServer()).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      transactionsByStatus: {},
      duplicates: 0,
      retries: 0,
      dlqMessages: 0,
      lockConflicts: 0,
      outboxLagMs: 0,
      processingLatencyMs: { count: 0, average: 0, max: 0 },
      reconciliationMismatches: 0,
    });
  });

  it('reconciles wallet and ledger from one locked transactional snapshot', async () => {
    const playerId = randomUUID();
    const walletResponse = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });
    const walletId = walletResponse.body.id as string;
    const queries = app.get(WageringQueryService);
    const processor = app.get(ProcessWagerTransactionUseCase);
    const originalFindAll =
      MikroOrmWalletLedgerEntryRepository.prototype.findAllByWalletId;
    let releaseLedgerRead!: () => void;
    let signalLedgerRead!: () => void;
    const ledgerReadReleased = new Promise<void>((resolve) => {
      releaseLedgerRead = resolve;
    });
    const ledgerReadStarted = new Promise<void>((resolve) => {
      signalLedgerRead = resolve;
    });

    MikroOrmWalletLedgerEntryRepository.prototype.findAllByWalletId =
      async function (requestedWalletId) {
        signalLedgerRead();
        await ledgerReadReleased;
        return originalFindAll.call(this, requestedWalletId);
      };

    try {
      const reconciliationPromise = queries.reconcileWallet(walletId);
      await ledgerReadStarted;
      let wagerFinished = false;
      const externalTransactionId = `reconciliation-bet-${randomUUID()}`;
      const wagerPromise = processor
        .execute({
          providerId: 'provider-reconciliation',
          externalTransactionId,
          idempotencyKey: `provider-reconciliation:${externalTransactionId}`,
          walletId,
          playerId,
          roundId: 'round-reconciliation',
          gameId: 'game-reconciliation',
          kind: WagerTransactionKind.Bet,
          money: Money.from({ amount: '25.00', currency: 'BRL' }),
        })
        .finally(() => {
          wagerFinished = true;
        });

      await Bun.sleep(20);
      expect(wagerFinished).toBe(false);

      releaseLedgerRead();
      const [reconciliation] = await Promise.all([
        reconciliationPromise,
        wagerPromise,
      ]);

      expect(reconciliation.consistent).toBe(true);
      expect(reconciliation.storedBalance.toJSON().amount).toBe('100.00');
      expect(reconciliation.calculatedBalance.toJSON().amount).toBe('100.00');
    } finally {
      releaseLedgerRead();
      MikroOrmWalletLedgerEntryRepository.prototype.findAllByWalletId =
        originalFindAll;
    }

    const finalReconciliation = await queries.reconcileWallet(walletId);
    expect(finalReconciliation.consistent).toBe(true);
    expect(finalReconciliation.storedBalance.toJSON().amount).toBe('75.00');
    expect(finalReconciliation.calculatedBalance.toJSON().amount).toBe('75.00');
  });
});
