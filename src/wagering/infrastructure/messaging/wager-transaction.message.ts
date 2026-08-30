import { randomUUID } from 'node:crypto';

import type { ProcessWagerTransactionInput } from '../../application/use-cases/process-wager-transaction.use-case.js';
import { WagerTransactionKind } from '../../domain/wager-transaction.js';

export const WAGER_TRANSACTION_REQUESTED = 'WagerTransactionRequested';

export interface WagerTransactionMessageData {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: {
    amount: string;
    currency: string;
  };
  referenceExternalTransactionId?: string;
}

export interface WagerTransactionMessage {
  messageId: string;
  type: typeof WAGER_TRANSACTION_REQUESTED;
  occurredAt: string;
  data: WagerTransactionMessageData;
}

export class InvalidWagerTransactionMessageError extends Error {
  constructor() {
    super('Invalid wager transaction message');
    this.name = 'InvalidWagerTransactionMessageError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function createWagerTransactionMessage(
  input: ProcessWagerTransactionInput,
  messageId = randomUUID(),
  occurredAt = new Date(),
): WagerTransactionMessage {
  return {
    messageId,
    type: WAGER_TRANSACTION_REQUESTED,
    occurredAt: occurredAt.toISOString(),
    data: {
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money.toJSON(),
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    },
  };
}

export function parseWagerTransactionMessage(
  body: string,
): WagerTransactionMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    throw new InvalidWagerTransactionMessageError();
  }

  if (!isRecord(parsed) || !isRecord(parsed.data)) {
    throw new InvalidWagerTransactionMessageError();
  }

  const { data } = parsed;
  const money = data.money;
  const occurredAt = parsed.occurredAt;
  const requiredData = [
    data.providerId,
    data.externalTransactionId,
    data.idempotencyKey,
    data.walletId,
    data.playerId,
    data.roundId,
    data.gameId,
    data.kind,
  ];
  const requiresReference =
    data.kind === WagerTransactionKind.Refund ||
    data.kind === WagerTransactionKind.Rollback;

  if (
    !isNonEmptyString(parsed.messageId) ||
    parsed.type !== WAGER_TRANSACTION_REQUESTED ||
    !isNonEmptyString(occurredAt) ||
    Number.isNaN(Date.parse(occurredAt)) ||
    requiredData.some((value) => !isNonEmptyString(value)) ||
    !Object.values(WagerTransactionKind).includes(
      data.kind as WagerTransactionKind,
    ) ||
    data.kind === WagerTransactionKind.Opening ||
    (requiresReference &&
      !isNonEmptyString(data.referenceExternalTransactionId)) ||
    !isRecord(money) ||
    !isNonEmptyString(money.amount) ||
    !isNonEmptyString(money.currency) ||
    (data.referenceExternalTransactionId !== undefined &&
      !isNonEmptyString(data.referenceExternalTransactionId))
  ) {
    throw new InvalidWagerTransactionMessageError();
  }

  return parsed as unknown as WagerTransactionMessage;
}
