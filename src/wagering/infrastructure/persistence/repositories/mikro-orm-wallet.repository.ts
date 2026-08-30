import type { EntityManager } from '@mikro-orm/postgresql';

import type { WalletRepository } from '../../../application/ports/wallet.repository.js';
import { Money } from '../../../domain/money.js';
import { Wallet } from '../../../domain/wallet.js';

interface WalletRow {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async insert(wallet: Wallet): Promise<void> {
    const balance = wallet.balance.toJSON();

    await this.entityManager.execute(
      `
        insert into wallets (
          id,
          player_id,
          currency,
          balance,
          version,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        wallet.id,
        wallet.playerId,
        wallet.currency,
        balance.amount,
        wallet.version,
        wallet.createdAt,
        wallet.updatedAt,
      ],
      'run',
    );
  }

  async findById(id: string): Promise<Wallet | undefined> {
    return this.findOne('where id = ?', [id]);
  }

  async findByPlayerAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | undefined> {
    return this.findOne('where player_id = ? and currency = ?', [
      playerId,
      currency,
    ]);
  }

  private async findOne(
    whereClause: string,
    params: unknown[],
  ): Promise<Wallet | undefined> {
    const [row] = await this.entityManager.execute<WalletRow[]>(
      `
        select
          id,
          player_id as "playerId",
          currency,
          balance::text as balance,
          version,
          created_at as "createdAt",
          updated_at as "updatedAt"
        from wallets
        ${whereClause}
        limit 1
      `,
      params,
    );

    if (!row) {
      return;
    }

    return Wallet.rehydrate({
      id: row.id,
      playerId: row.playerId,
      currency: row.currency,
      balance: Money.from({
        amount: row.balance,
        currency: row.currency,
      }),
      version: row.version,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    });
  }
}
