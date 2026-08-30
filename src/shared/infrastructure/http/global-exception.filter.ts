import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';

import {
  InvalidCurrencyError,
  InvalidMoneyAmountError,
} from '../../domain/errors.js';

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
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof HttpException) {
      return response
        .status(exception.getStatus())
        .json(exception.getResponse());
    }

    if (
      exception instanceof InvalidMoneyAmountError ||
      exception instanceof InvalidCurrencyError
    ) {
      const error = new BadRequestException(exception.message);

      return response.status(error.getStatus()).json(error.getResponse());
    }

    if (
      hasConstraint(exception) &&
      exception.constraint === 'wallets_player_id_currency_unique'
    ) {
      const error = new ConflictException(
        'Wallet already exists for this player and currency',
      );

      return response.status(error.getStatus()).json(error.getResponse());
    }

    const error = new InternalServerErrorException();

    return response.status(error.getStatus()).json(error.getResponse());
  }
}
