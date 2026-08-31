import { Migration } from '@mikro-orm/migrations';

export class Migration20260830000200_reference_hardening extends Migration {
  override name = 'Migration20260830000200_reference_hardening';

  override up(): void | Promise<void> {
    this.addSql(`
      update "wager_transactions"
        set "next_reference_retry_at" = "created_at"
        where "status" = 'PENDING_REFERENCE'
          and "next_reference_retry_at" is null;
    `);
  }

  override down(): void | Promise<void> {
    this.addSql(`
      update "wager_transactions"
        set "next_reference_retry_at" = null
        where "status" = 'PENDING_REFERENCE'
          and "reference_retry_attempts" = 0
          and "next_reference_retry_at" = "created_at";
    `);
  }
}
