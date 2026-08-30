import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallets' })
export class WalletOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({
    type: 'uuid',
    fieldName: 'player_id',
  })
  playerId!: string;

  @Property({
    length: 3,
  })
  currency!: string;

  @Property({
    columnType: 'numeric(20,2)',
  })
  balance!: string;

  @Property()
  version!: number;

  @Property({
    fieldName: 'created_at',
  })
  createdAt!: Date;

  @Property({
    fieldName: 'updated_at',
  })
  updatedAt!: Date;
}
