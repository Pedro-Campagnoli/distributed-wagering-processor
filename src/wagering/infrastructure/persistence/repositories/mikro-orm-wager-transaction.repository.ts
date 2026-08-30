import type { EntityManager } from '@mikro-orm/postgresql';

import type { WagerTransactionRepository } from '../../../application/ports/wager-transaction.repository.js';
import { Money } from '../../../domain/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wager-transaction.js';

interface WagerTransactionRow {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  status: WagerTransactionStatus;
  failureCode: string | null;
  createdAt: string;
  processedAt: string | null;
}

export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async insert(transaction: WagerTransaction): Promise<void> {
    const money = transaction.money.toJSON();

    await this.entityManager.execute(
      `
        insert into wager_transactions (
          id,
          provider_id,
          external_transaction_id,
          idempotency_key,
          payload_hash,
          wallet_id,
          player_id,
          round_id,
          game_id,
          kind,
          amount,
          currency,
          reference_external_transaction_id,
          reference_transaction_id,
          status,
          failure_code,
          created_at,
          processed_at,
          observed_balance
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        transaction.id,
        transaction.providerId,
        transaction.externalTransactionId,
        transaction.idempotencyKey,
        transaction.payloadHash,
        transaction.walletId,
        transaction.playerId,
        transaction.roundId,
        transaction.gameId,
        transaction.kind,
        money.amount,
        money.currency,
        transaction.referenceExternalTransactionId ?? null,
        transaction.referenceTransactionId ?? null,
        transaction.status,
        transaction.failureCode ?? null,
        transaction.createdAt,
        transaction.processedAt ?? null,
        null,
      ],
      'run',
    );
  }

  async findById(id: string): Promise<WagerTransaction | undefined> {
    return this.findOne('where id = ?', [id]);
  }

  async findByProviderAndExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined> {
    return this.findOne(
      'where provider_id = ? and external_transaction_id = ?',
      [providerId, externalTransactionId],
    );
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | undefined> {
    return this.findOne('where idempotency_key = ?', [idempotencyKey]);
  }

  private async findOne(
    whereClause: string,
    params: unknown[],
  ): Promise<WagerTransaction | undefined> {
    const [row] = await this.entityManager.execute<WagerTransactionRow[]>(
      `
        select
          id,
          provider_id as "providerId",
          external_transaction_id as "externalTransactionId",
          idempotency_key as "idempotencyKey",
          payload_hash as "payloadHash",
          wallet_id as "walletId",
          player_id as "playerId",
          round_id as "roundId",
          game_id as "gameId",
          kind,
          amount::text as amount,
          currency,
          reference_external_transaction_id as "referenceExternalTransactionId",
          reference_transaction_id as "referenceTransactionId",
          status,
          failure_code as "failureCode",
          created_at as "createdAt",
          processed_at as "processedAt"
        from wager_transactions
        ${whereClause}
        limit 1
      `,
      params,
    );

    if (!row) {
      return;
    }

    return WagerTransaction.rehydrate({
      id: row.id,
      providerId: row.providerId,
      externalTransactionId: row.externalTransactionId,
      idempotencyKey: row.idempotencyKey,
      payloadHash: row.payloadHash,
      walletId: row.walletId,
      playerId: row.playerId,
      roundId: row.roundId,
      gameId: row.gameId,
      kind: row.kind,
      money: Money.from({
        amount: row.amount,
        currency: row.currency,
      }),
      referenceExternalTransactionId:
        row.referenceExternalTransactionId ?? undefined,
      createdAt: new Date(row.createdAt),
      status: row.status,
      referenceTransactionId: row.referenceTransactionId ?? undefined,
      failureCode: row.failureCode ?? undefined,
      processedAt: row.processedAt ? new Date(row.processedAt) : undefined,
    });
  }
}
