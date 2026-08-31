import type { WalletLedgerEntry } from '../../domain/wallet-ledger-entry.js';

export interface WalletLedgerCursor {
  createdAt: Date;
  id: string;
}

export interface WalletLedgerEntryRepository {
  insert(entry: WalletLedgerEntry): Promise<void>;

  findPageByWalletId(
    walletId: string,
    cursor: WalletLedgerCursor | undefined,
    limit: number,
  ): Promise<WalletLedgerEntry[]>;

  findAllByWalletId(walletId: string): Promise<WalletLedgerEntry[]>;
}
