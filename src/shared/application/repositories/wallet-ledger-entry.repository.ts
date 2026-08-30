import type { WalletLedgerEntry } from '../../domain/wallet-ledger-entry.js';

export interface WalletLedgerEntryRepository {
  insert(entry: WalletLedgerEntry): Promise<void>;
}
