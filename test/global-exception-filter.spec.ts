import {
  BadRequestException,
  Controller,
  Get,
  INestApplication,
  Param,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DeadlockException,
  DriverException,
  LockWaitTimeoutException,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import request from 'supertest';

import {
  ExternalOpeningTransactionError,
  IdempotencyConflictError,
  InvalidCurrencyError,
  InvalidLedgerCursorError,
  InvalidMoneyAmountError,
  MissingTransactionReferenceError,
  WagerTransactionNotFoundError,
  WalletNotFoundError,
  WalletPlayerMismatchError,
} from '../src/wagering/domain/errors.js';
import { GlobalExceptionFilter } from '../src/wagering/presentation/http/filters/global-exception.filter.js';

function uniqueViolation(
  constraint: string,
): UniqueConstraintViolationException {
  return new UniqueConstraintViolationException(
    Object.assign(new Error('duplicate key; SQL: sensitive statement'), {
      constraint,
    }),
  );
}

@Controller('filter-test')
class FilterTestController {
  @Get(':error')
  fail(@Param('error') error: string): never {
    switch (error) {
      case 'http':
        throw new BadRequestException({ message: 'preserved response' });
      case 'money':
        throw new InvalidMoneyAmountError('invalid');
      case 'currency':
        throw new InvalidCurrencyError('invalid');
      case 'missing-reference':
        throw new MissingTransactionReferenceError();
      case 'external-opening':
        throw new ExternalOpeningTransactionError();
      case 'cursor':
        throw new InvalidLedgerCursorError();
      case 'wallet-player':
        throw new WalletPlayerMismatchError();
      case 'wallet-not-found':
        throw new WalletNotFoundError('wallet-id');
      case 'transaction-not-found':
        throw new WagerTransactionNotFoundError();
      case 'idempotency':
        throw new IdempotencyConflictError('idempotency-key');
      case 'wallet-unique':
        throw uniqueViolation('wallets_player_id_currency_unique');
      case 'idempotency-unique':
        throw uniqueViolation('wager_transactions_idempotency_key_unique');
      case 'external-id-unique':
        throw uniqueViolation('wager_transactions_provider_external_id_unique');
      case 'reversal-unique':
        throw uniqueViolation('wager_transactions_reversal_once_idx');
      case 'unknown-unique':
        throw uniqueViolation('internal_unknown_unique');
      case 'driver':
        throw new DriverException(new Error('SQL: sensitive statement'));
      case 'lock-timeout':
        throw new LockWaitTimeoutException(new Error('lock details'));
      case 'deadlock':
        throw new DeadlockException(new Error('deadlock details'));
      default:
        throw new Error('stack and internal implementation details');
    }
  }
}

describe('GlobalExceptionFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FilterTestController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('preserves HttpException responses', async () => {
    const response = await request(app.getHttpServer()).get(
      '/filter-test/http',
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'preserved response' });
  });

  it.each([
    'money',
    'currency',
    'missing-reference',
    'external-opening',
    'cursor',
    'wallet-player',
  ])('maps invalid input %s to 400', async (error) => {
    const response = await request(app.getHttpServer()).get(
      `/filter-test/${error}`,
    );

    expect(response.status).toBe(400);
  });

  it.each(['wallet-not-found', 'transaction-not-found'])(
    'maps known missing resource %s to 404',
    async (error) => {
      const response = await request(app.getHttpServer()).get(
        `/filter-test/${error}`,
      );

      expect(response.status).toBe(404);
    },
  );

  it('maps idempotency conflict to 409', async () => {
    const response = await request(app.getHttpServer()).get(
      '/filter-test/idempotency',
    );

    expect(response.status).toBe(409);
  });

  it.each([
    'wallet-unique',
    'idempotency-unique',
    'external-id-unique',
    'reversal-unique',
  ])('maps known uniqueness %s to a sanitized 409', async (error) => {
    const response = await request(app.getHttpServer()).get(
      `/filter-test/${error}`,
    );
    const serializedBody = JSON.stringify(response.body);

    expect(response.status).toBe(409);
    expect(serializedBody).not.toContain('constraint');
    expect(serializedBody).not.toContain('SQL');
    expect(serializedBody).not.toContain('sensitive');
  });

  it.each(['unknown-unique', 'driver', 'unknown'])(
    'maps unexpected failure %s to a sanitized 500',
    async (error) => {
      const response = await request(app.getHttpServer()).get(
        `/filter-test/${error}`,
      );

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        message: 'Internal Server Error',
        statusCode: 500,
      });
    },
  );

  it.each(['lock-timeout', 'deadlock'])(
    'uses 503 only for identified transient error %s',
    async (error) => {
      const response = await request(app.getHttpServer()).get(
        `/filter-test/${error}`,
      );

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        message: 'Infrastructure temporarily unavailable',
        error: 'Service Unavailable',
        statusCode: 503,
      });
    },
  );
});
