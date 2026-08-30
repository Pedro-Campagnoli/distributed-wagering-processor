import { Money } from '../../../domain/money.js';
import { Wallet } from '../../../domain/wallet.js';
import { WalletOrmEntity } from '../entities/wallet.orm-entity.js';

export class WalletMapper {
  static toDomain(entity: WalletOrmEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.from({
        amount: entity.balance,
        currency: entity.currency,
      }),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  static toOrm(wallet: Wallet): WalletOrmEntity {
    const entity = new WalletOrmEntity();

    entity.id = wallet.id;
    entity.playerId = wallet.playerId;
    entity.currency = wallet.currency;
    entity.balance = wallet.balance.toJSON().amount;
    entity.version = wallet.version;
    entity.createdAt = wallet.createdAt;
    entity.updatedAt = wallet.updatedAt;

    return entity;
  }

  static updateOrm(wallet: Wallet, entity: WalletOrmEntity): void {
    entity.playerId = wallet.playerId;
    entity.currency = wallet.currency;
    entity.balance = wallet.balance.toJSON().amount;
    entity.version = wallet.version;
    entity.updatedAt = wallet.updatedAt;
  }
}
