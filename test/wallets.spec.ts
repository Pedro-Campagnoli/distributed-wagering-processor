import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { type EntityManager, MikroORM } from '@mikro-orm/postgresql';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import request from 'supertest';

import { AppModule } from '../src/app.module.js';

import { LedgerDirection } from '../src/wagering/domain/wallet-ledger-entry.js';

import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';

import { GlobalExceptionFilter } from '../src/wagering/presentation/http/filters/global-exception.filter.js';

const PLAYER_ID = 'd81561b6-fd23-4d38-8fbd-5b93fc5ec429';

describe('POST /wallets', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();

    orm = app.get(MikroORM);
  });

  beforeEach(async () => {
    await orm.schema.clear({
      truncate: true,
    });

    em = orm.em.fork();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.clear({
        truncate: true,
      });
    }

    if (app) {
      await app.close();
    }
  });

  test('creates a wallet with zero initial balance', async () => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: PLAYER_ID,
        initialBalance: {
          amount: '0.00',
          currency: 'BRL',
        },
      });

    expect(response.status).toBe(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      playerId: PLAYER_ID,
      balance: {
        amount: '0.00',
        currency: 'BRL',
      },
      version: 1,
    });

    const walletId = response.body.id as string;

    const [walletCount, transactionCount, ledgerCount] = await Promise.all([
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

    expect(walletCount).toBe(1);
    expect(transactionCount).toBe(0);
    expect(ledgerCount).toBe(0);
  });

  test('creates a wallet with OPENING and CREDIT ledger for positive balance', async () => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: PLAYER_ID,
        initialBalance: {
          amount: '100.00',
          currency: 'BRL',
        },
      });

    expect(response.status).toBe(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      playerId: PLAYER_ID,
      balance: {
        amount: '100.00',
        currency: 'BRL',
      },
      version: 1,
    });

    const walletId = response.body.id as string;

    em.clear();

    const transaction = await em.findOne(WagerTransactionOrmEntity, {
      walletId,
    });

    expect(transaction).toBeDefined();

    expect(transaction?.kind).toBe('OPENING');

    expect(transaction?.status).toBe('PROCESSED');

    expect(transaction?.amount).toBe('100.00');

    expect(transaction?.currency).toBe('BRL');

    const ledger = await em.findOne(WalletLedgerEntryOrmEntity, {
      walletId,
    });

    expect(ledger).toBeDefined();

    expect(ledger?.direction).toBe(LedgerDirection.Credit);

    expect(ledger?.amount).toBe('100.00');

    expect(ledger?.balanceBefore).toBe('0.00');

    expect(ledger?.balanceAfter).toBe('100.00');

    expect(ledger?.currency).toBe('BRL');
  });

  test('rejects an invalid transport payload', async () => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: 'invalid-player-id',
        initialBalance: {
          amount: 100,
          currency: 'BRL',
        },
      });

    expect(response.status).toBe(400);
  });

  test('rejects an invalid money amount', async () => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: PLAYER_ID,
        initialBalance: {
          amount: '-300.00',
          currency: 'BRL',
        },
      });

    expect(response.status).toBe(400);
  });

  test('rejects an invalid currency', async () => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: PLAYER_ID,
        initialBalance: {
          amount: '100.00',
          currency: 'INVALID',
        },
      });

    expect(response.status).toBe(400);
  });

  test('returns conflict when wallet already exists for player and currency', async () => {
    const payload = {
      playerId: PLAYER_ID,
      initialBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
    };

    const firstResponse = await request(app.getHttpServer())
      .post('/wallets')
      .send(payload);

    expect(firstResponse.status).toBe(201);

    const secondResponse = await request(app.getHttpServer())
      .post('/wallets')
      .send(payload);

    expect(secondResponse.status).toBe(409);
  });
});
