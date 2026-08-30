import { MikroORM } from '@mikro-orm/postgresql';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import { GlobalExceptionFilter } from '../src/shared/infrastructure/http/global-exception.filter.js';

const DATABASE_TESTS_ENABLED = process.env.RUN_DATABASE_TESTS === '1';

const describeDatabase = DATABASE_TESTS_ENABLED ? describe : describe.skip;

const PLAYER_ID = 'd81561b6-fd23-4d38-8fbd-5b93fc5ec429';

describeDatabase('POST /wallets', () => {
  let app: INestApplication;
  let orm: MikroORM;

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
    const entityManager = orm.em.fork();

    await entityManager.execute(`
      truncate table
        wallet_ledger_entries,
        wager_transactions,
        wallets,
        inbox_messages,
        outbox_messages
      cascade
    `);
  });

  afterAll(async () => {
    if (orm) {
      const entityManager = orm.em.fork();

      await entityManager.execute(`
        truncate table
          wallet_ledger_entries,
          wager_transactions,
          wallets,
          inbox_messages,
          outbox_messages
        cascade
      `);
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

    const entityManager = orm.em.fork();

    const [walletCount] = await entityManager.execute<{ count: number }[]>(
      `
        select count(*)::int as count
        from wallets
        where id = ?
      `,
      [response.body.id],
    );

    const [transactionCount] = await entityManager.execute<{ count: number }[]>(
      `
        select count(*)::int as count
        from wager_transactions
        where wallet_id = ?
      `,
      [response.body.id],
    );

    const [ledgerCount] = await entityManager.execute<{ count: number }[]>(
      `
        select count(*)::int as count
        from wallet_ledger_entries
        where wallet_id = ?
      `,
      [response.body.id],
    );

    expect(walletCount?.count).toBe(1);
    expect(transactionCount?.count).toBe(0);
    expect(ledgerCount?.count).toBe(0);
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

    const entityManager = orm.em.fork();

    const [transaction] = await entityManager.execute<
      {
        kind: string;
        status: string;
        amount: string;
        currency: string;
      }[]
    >(
      `
        select
          kind,
          status,
          amount::text as amount,
          currency
        from wager_transactions
        where wallet_id = ?
      `,
      [response.body.id],
    );

    expect(transaction).toEqual({
      kind: 'OPENING',
      status: 'PROCESSED',
      amount: '100.00',
      currency: 'BRL',
    });

    const [ledger] = await entityManager.execute<
      {
        direction: string;
        amount: string;
        balanceBefore: string;
        balanceAfter: string;
        currency: string;
      }[]
    >(
      `
        select
          direction,
          amount::text as amount,
          balance_before::text as "balanceBefore",
          balance_after::text as "balanceAfter",
          currency
        from wallet_ledger_entries
        where wallet_id = ?
      `,
      [response.body.id],
    );

    expect(ledger).toEqual({
      direction: 'CREDIT',
      amount: '100.00',
      balanceBefore: '0.00',
      balanceAfter: '100.00',
      currency: 'BRL',
    });
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
