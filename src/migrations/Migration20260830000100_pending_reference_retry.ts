import { Migration } from '@mikro-orm/migrations';

export class Migration20260830000100_pending_reference_retry extends Migration {
  override name = 'Migration20260830000100_pending_reference_retry';

  override up(): void | Promise<void> {
    this.addSql(`
      alter table "wager_transactions"
        add column "reference_retry_attempts" integer not null default 0,
        add column "next_reference_retry_at" timestamptz null,
        add constraint "wager_transactions_reference_retry_attempts_non_negative_check"
          check ("reference_retry_attempts" >= 0);
    `);

    this.addSql(`
      drop index if exists "wager_transactions_pending_reference_idx";
    `);

    this.addSql(`
      create index "wager_transactions_pending_reference_idx"
        on "wager_transactions" (
          "next_reference_retry_at",
          "created_at",
          "id"
        )
        where "status" = 'PENDING_REFERENCE';
    `);
  }

  override down(): void | Promise<void> {
    this.addSql(`
      drop index if exists "wager_transactions_pending_reference_idx";
    `);

    this.addSql(`
      create index "wager_transactions_pending_reference_idx"
        on "wager_transactions" ("created_at", "id")
        where "status" = 'PENDING_REFERENCE';
    `);

    this.addSql(`
      alter table "wager_transactions"
        drop constraint if exists "wager_transactions_reference_retry_attempts_non_negative_check",
        drop column if exists "next_reference_retry_at",
        drop column if exists "reference_retry_attempts";
    `);
  }
}
