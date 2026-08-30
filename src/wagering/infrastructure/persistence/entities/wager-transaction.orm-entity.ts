import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wager_transactions' })
export class WagerTransactionOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({
    fieldName: 'provider_id',
  })
  providerId!: string;

  @Property({
    fieldName: 'external_transaction_id',
  })
  externalTransactionId!: string;

  @Property({
    fieldName: 'idempotency_key',
  })
  idempotencyKey!: string;

  @Property({
    fieldName: 'payload_hash',
  })
  payloadHash!: string;

  @Property({
    type: 'uuid',
    fieldName: 'wallet_id',
  })
  walletId!: string;

  @Property({
    type: 'uuid',
    fieldName: 'player_id',
  })
  playerId!: string;

  @Property({
    fieldName: 'round_id',
  })
  roundId!: string;

  @Property({
    fieldName: 'game_id',
  })
  gameId!: string;

  @Property()
  kind!: string;

  @Property({
    columnType: 'numeric(20,2)',
  })
  amount!: string;

  @Property({
    length: 3,
  })
  currency!: string;

  @Property({
    fieldName: 'reference_external_transaction_id',
    nullable: true,
  })
  referenceExternalTransactionId!: string | null;

  @Property({
    type: 'uuid',
    fieldName: 'reference_transaction_id',
    nullable: true,
  })
  referenceTransactionId!: string | null;

  @Property()
  status!: string;

  @Property({
    fieldName: 'failure_code',
    nullable: true,
  })
  failureCode!: string | null;

  @Property({
    columnType: 'numeric(20,2)',
    fieldName: 'observed_balance',
    nullable: true,
  })
  observedBalance!: string | null;

  @Property({
    fieldName: 'created_at',
  })
  createdAt!: Date;

  @Property({
    fieldName: 'processed_at',
    nullable: true,
  })
  processedAt!: Date | null;
}
