import { createHash } from 'node:crypto';

import type { Money } from '../../domain/money.js';
import type { WagerTransactionKind } from '../../domain/wager-transaction.js';

export interface WagerPayloadHashInput {
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }

  return value;
}

export function hashCanonicalPayload(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function calculateWagerPayloadHash(
  input: WagerPayloadHashInput,
): string {
  return hashCanonicalPayload({
    providerId: input.providerId,
    externalTransactionId: input.externalTransactionId,
    walletId: input.walletId,
    playerId: input.playerId,
    roundId: input.roundId,
    gameId: input.gameId,
    kind: input.kind,
    money: input.money.toJSON(),
    referenceExternalTransactionId: input.referenceExternalTransactionId,
  });
}
