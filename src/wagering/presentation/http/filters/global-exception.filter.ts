import {
  DeadlockException,
  DriverException,
  LockWaitTimeoutException,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  ExternalOpeningTransactionError,
  IdempotencyConflictError,
  InvalidLedgerCursorError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  MissingTransactionReferenceError,
  WagerTransactionNotFoundError,
  WalletNotFoundError,
  WalletPlayerMismatchError,
} from '../../../domain/errors.js';
import {
  OperationalMetrics,
  operationalMetrics,
} from '../../../infrastructure/observability/operational-metrics.js';

interface PostgreSqlConstraintError {
  constraint?: string;
}

const UNIQUE_CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = {
  wallets_player_id_currency_unique:
    'Wallet already exists for this player and currency',
  wager_transactions_idempotency_key_unique: 'Wager transaction already exists',
  wager_transactions_provider_external_id_unique:
    'Wager transaction already exists',
  wager_transactions_reversal_once_idx:
    'Reversal already processed for this reference',
};

function hasConstraint(
  exception: unknown,
): exception is UniqueConstraintViolationException & PostgreSqlConstraintError {
  return (
    exception instanceof UniqueConstraintViolationException &&
    'constraint' in exception
  );
}

function mapExpectedException(exception: unknown): HttpException | undefined {
  if (
    exception instanceof InvalidMoneyAmountError ||
    exception instanceof InvalidCurrencyError ||
    exception instanceof MissingTransactionReferenceError ||
    exception instanceof ExternalOpeningTransactionError ||
    exception instanceof InvalidLedgerCursorError ||
    exception instanceof WalletPlayerMismatchError
  ) {
    return new BadRequestException(exception.message);
  }

  if (exception instanceof IdempotencyConflictError) {
    return new ConflictException(exception.message);
  }

  if (
    exception instanceof WalletNotFoundError ||
    exception instanceof WagerTransactionNotFoundError
  ) {
    return new NotFoundException(exception.message);
  }

  if (hasConstraint(exception)) {
    const message = UNIQUE_CONSTRAINT_MESSAGES[exception.constraint ?? ''];

    if (message) {
      return new ConflictException(message);
    }
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(
    private readonly metrics: OperationalMetrics = operationalMetrics,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse();
    const request = http.getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      params?: Record<string, string | undefined>;
      body?: { walletId?: string; providerId?: string };
    }>();

    if (exception instanceof HttpException) {
      return response
        .status(exception.getStatus())
        .json(exception.getResponse());
    }

    const mappedException = mapExpectedException(exception);

    if (mappedException) {
      return response
        .status(mappedException.getStatus())
        .json(mappedException.getResponse());
    }

    if (
      exception instanceof LockWaitTimeoutException ||
      exception instanceof DeadlockException
    ) {
      this.metrics.recordLockConflict();
      this.logger.error(
        JSON.stringify({
          event: 'http_transient_infrastructure_failure',
          correlationId: request.headers?.['x-correlation-id'],
          transactionId: request.params?.transactionId,
          walletId: request.params?.walletId ?? request.body?.walletId,
          providerId: request.params?.providerId ?? request.body?.providerId,
          errorName: exception.name,
        }),
      );
      const error = new ServiceUnavailableException(
        'Infrastructure temporarily unavailable',
      );

      return response.status(error.getStatus()).json(error.getResponse());
    }

    if (exception instanceof DriverException) {
      this.logger.error(
        JSON.stringify({
          event: 'http_infrastructure_failure',
          correlationId: request.headers?.['x-correlation-id'],
          transactionId: request.params?.transactionId,
          walletId: request.params?.walletId ?? request.body?.walletId,
          providerId: request.params?.providerId ?? request.body?.providerId,
          errorName: exception.name,
        }),
      );

      const error = new InternalServerErrorException();

      return response.status(error.getStatus()).json(error.getResponse());
    }

    this.logger.error(
      JSON.stringify({
        event: 'http_unexpected_failure',
        correlationId: request.headers?.['x-correlation-id'],
        transactionId: request.params?.transactionId,
        walletId: request.params?.walletId ?? request.body?.walletId,
        providerId: request.params?.providerId ?? request.body?.providerId,
        errorName: exception instanceof Error ? exception.name : 'UnknownError',
      }),
    );

    const error = new InternalServerErrorException();

    return response.status(error.getStatus()).json(error.getResponse());
  }
}
