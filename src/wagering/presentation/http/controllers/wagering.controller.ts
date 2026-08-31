import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { ProcessWagerTransactionUseCase } from '../../../application/use-cases/process-wager-transaction.use-case.js';
import type { WagerTransaction } from '../../../domain/wager-transaction.js';
import { WagerTransactionStatus } from '../../../domain/wager-transaction.js';
import { Money } from '../../../domain/money.js';
import { IdempotencyConflictError } from '../../../domain/errors.js';
import { WageringQueryService } from '../../../application/services/wagering-query.service.js';
import { OperationalMetrics } from '../../../infrastructure/observability/operational-metrics.js';
import { ProcessWagerTransactionDto } from '../dto/process-wager-transaction.dto.js';

@Controller()
export class WageringController {
  private readonly logger = new Logger(WageringController.name);

  constructor(
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    private readonly queries: WageringQueryService,
    private readonly metrics: OperationalMetrics,
  ) {}

  @Post('wagering/transactions')
  async process(
    @Body() dto: ProcessWagerTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') suppliedCorrelationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const correlationId = suppliedCorrelationId?.trim() || randomUUID();
    const startedAt = performance.now();

    try {
      const result = await this.processWagerTransaction.execute({
        ...dto,
        idempotencyKey: idempotencyKey.trim(),
        money: Money.from(dto.money),
      });

      this.metrics.recordTransaction(result.transaction.status);

      if (result.idempotentReplay) {
        this.metrics.recordDuplicate();
      }

      response.status(
        this.statusFor(result.transaction.status, result.idempotentReplay),
      );
      this.logger.log(
        JSON.stringify({
          event: 'wager_transaction_completed',
          correlationId,
          transactionId: result.transaction.id,
          walletId: result.transaction.walletId,
          providerId: result.transaction.providerId,
          status: result.transaction.status,
          idempotentReplay: result.idempotentReplay,
        }),
      );

      return {
        transactionId: result.transaction.id,
        status: result.transaction.status,
        balance: result.observedBalance?.toJSON(),
        idempotentReplay: result.idempotentReplay,
      };
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        this.metrics.recordDuplicate();
      }

      throw error;
    } finally {
      this.metrics.recordProcessingLatency(performance.now() - startedAt);
    }
  }

  @Get('wagering/transactions/:transactionId')
  async findById(
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
  ) {
    return this.serializeTransaction(
      await this.queries.getTransactionById(transactionId),
    );
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async findByProvider(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return this.serializeTransaction(
      await this.queries.getTransactionByProvider(
        providerId,
        externalTransactionId,
      ),
    );
  }

  private statusFor(
    status: WagerTransactionStatus,
    idempotentReplay: boolean,
  ): number {
    if (idempotentReplay) {
      return HttpStatus.OK;
    }

    switch (status) {
      case WagerTransactionStatus.PendingReference:
        return HttpStatus.ACCEPTED;
      case WagerTransactionStatus.Rejected:
        return HttpStatus.UNPROCESSABLE_ENTITY;
      case WagerTransactionStatus.Failed:
        return HttpStatus.SERVICE_UNAVAILABLE;
      default:
        return HttpStatus.CREATED;
    }
  }

  private serializeTransaction(transaction: WagerTransaction) {
    return {
      transactionId: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      money: transaction.money.toJSON(),
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId,
      referenceTransactionId: transaction.referenceTransactionId,
      status: transaction.status,
      failureCode: transaction.failureCode,
      observedBalance: transaction.observedBalance?.toJSON(),
      createdAt: transaction.createdAt.toISOString(),
      processedAt: transaction.processedAt?.toISOString(),
    };
  }
}
