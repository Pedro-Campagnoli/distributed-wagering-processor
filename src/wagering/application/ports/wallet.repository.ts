import { Wallet } from '@/wagering/domain/wallet.js';

export interface WalletRepository {
  insert(wallet: Wallet): Promise<void>;

  update(wallet: Wallet): Promise<void>;

  findById(id: string): Promise<Wallet | undefined>;

  findByPlayerAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | undefined>;
}
