import { randomUUID } from 'node:crypto';

import { Money } from '../../domain/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../domain/wager-transaction.js';
import { ExternalOpeningTransactionError } from '@/shared/domain/errors.js';

export interface ProcessWagerTransactionInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

type IdGenerator = () => string;

export class ProcessWagerTransactionUseCase {
  constructor(private readonly idGenerator: IdGenerator = randomUUID) {}

  execute(input: ProcessWagerTransactionInput): WagerTransaction {
    if (input.kind === WagerTransactionKind.Opening) {
      throw new ExternalOpeningTransactionError();
    }

    return WagerTransaction.create({
      id: this.idGenerator(),
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });
  }
}
