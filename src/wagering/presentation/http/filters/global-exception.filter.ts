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
  UnprocessableEntityException,
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

function hasConstraint(
  exception: unknown,
): exception is UniqueConstraintViolationException & PostgreSqlConstraintError {
  return (
    exception instanceof UniqueConstraintViolationException &&
    'constraint' in exception
  );
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

    if (
      exception instanceof InvalidMoneyAmountError ||
      exception instanceof InvalidCurrencyError ||
      exception instanceof MissingTransactionReferenceError ||
      exception instanceof ExternalOpeningTransactionError ||
      exception instanceof InvalidLedgerCursorError
    ) {
      const error = new BadRequestException(exception.message);

      return response.status(error.getStatus()).json(error.getResponse());
    }

    if (exception instanceof IdempotencyConflictError) {
      const error = new ConflictException(exception.message);

      return response.status(error.getStatus()).json(error.getResponse());
    }

    if (
      exception instanceof WalletNotFoundError ||
      exception instanceof WagerTransactionNotFoundError
    ) {
      const error = new NotFoundException(exception.message);

      return response.status(error.getStatus()).json(error.getResponse());
    }

    if (exception instanceof WalletPlayerMismatchError) {
      const error = new UnprocessableEntityException(exception.message);

      return response.status(error.getStatus()).json(error.getResponse());
    }

    if (
      hasConstraint(exception) &&
      [
        'wallets_player_id_currency_unique',
        'wager_transactions_idempotency_key_unique',
        'wager_transactions_provider_external_id_unique',
      ].includes(exception.constraint ?? '')
    ) {
      const message =
        exception.constraint === 'wallets_player_id_currency_unique'
          ? 'Wallet already exists for this player and currency'
          : 'Wager transaction already exists';
      const error = new ConflictException(message);

      return response.status(error.getStatus()).json(error.getResponse());
    }

    if (
      exception instanceof LockWaitTimeoutException ||
      exception instanceof DeadlockException
    ) {
      this.metrics.recordLockConflict();
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
      const error = new ServiceUnavailableException(
        'Infrastructure temporarily unavailable',
      );

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
