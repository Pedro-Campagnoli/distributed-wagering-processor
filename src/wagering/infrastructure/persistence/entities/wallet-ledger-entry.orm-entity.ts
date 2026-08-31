import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import type { LedgerDirection } from '../../../domain/wallet-ledger-entry.js';

@Entity({ tableName: 'wallet_ledger_entries' })
export class WalletLedgerEntryOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({
    type: 'uuid',
    fieldName: 'wallet_id',
  })
  walletId!: string;

  @Property({
    type: 'uuid',
    fieldName: 'transaction_id',
  })
  transactionId!: string;

  @Property()
  direction!: LedgerDirection;

  @Property({
    columnType: 'numeric(20,2)',
  })
  amount!: string;

  @Property({
    length: 3,
  })
  currency!: string;

  @Property({
    columnType: 'numeric(20,2)',
    fieldName: 'balance_before',
  })
  balanceBefore!: string;

  @Property({
    columnType: 'numeric(20,2)',
    fieldName: 'balance_after',
  })
  balanceAfter!: string;

  @Property({
    fieldName: 'created_at',
  })
  createdAt!: Date;
}
