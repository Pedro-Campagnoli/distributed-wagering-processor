import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'outbox_messages' })
export class OutboxMessageOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid', fieldName: 'aggregate_id' })
  aggregateId!: string;

  @Property({ fieldName: 'event_type' })
  eventType!: string;

  @Property({ type: 'json', columnType: 'jsonb' })
  payload!: Record<string, unknown>;

  @Property({ fieldName: 'occurred_at' })
  occurredAt!: Date;

  @Property()
  attempts!: number;

  @Property({ type: Date, fieldName: 'next_attempt_at', nullable: true })
  nextAttemptAt!: Date | null;

  @Property({ type: Date, fieldName: 'published_at', nullable: true })
  publishedAt!: Date | null;
}
