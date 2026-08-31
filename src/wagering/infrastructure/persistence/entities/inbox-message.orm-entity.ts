import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'inbox_messages' })
export class InboxMessageOrmEntity {
  @PrimaryKey({ fieldName: 'message_id' })
  messageId!: string;

  @PrimaryKey({ fieldName: 'consumer_name' })
  consumerName!: string;

  @Property({ fieldName: 'payload_hash' })
  payloadHash!: string;

  @Property({ fieldName: 'received_at' })
  receivedAt!: Date;

  @Property({ type: Date, fieldName: 'processed_at', nullable: true })
  processedAt!: Date | null;
}
