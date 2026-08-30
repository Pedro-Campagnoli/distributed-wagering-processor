import { Migration } from '@mikro-orm/migrations';

export class Migration20260830000009_database_invariants extends Migration {
  override name = 'Migration20260830000009_database_invariants';

  override up(): void | Promise<void> {
    this.addSql(`
      alter table "wager_transactions"
        add column "observed_balance" numeric(20, 2) null;
    `);

    this.addSql(`
      alter table "wallets"
        add constraint "wallets_player_id_currency_unique"
          unique ("player_id", "currency"),
        add constraint "wallets_balance_non_negative_check"
          check ("balance" >= 0),
        add constraint "wallets_version_positive_check"
          check ("version" >= 1),
        add constraint "wallets_currency_format_check"
          check ("currency" ~ '^[A-Z]{3}$');
    `);

    this.addSql(`
      alter table "wager_transactions"
        add constraint "wager_transactions_kind_check"
          check (
            "kind" in (
              'OPENING',
              'BET',
              'WIN',
              'LOSS',
              'REFUND',
              'ROLLBACK'
            )
          ),
        add constraint "wager_transactions_status_check"
          check (
            "status" in (
              'PENDING',
              'PENDING_REFERENCE',
              'PROCESSED',
              'REJECTED',
              'FAILED'
            )
          ),
        add constraint "wager_transactions_amount_non_negative_check"
          check ("amount" >= 0),
        add constraint "wager_transactions_observed_balance_non_negative_check"
          check (
            "observed_balance" is null
            or "observed_balance" >= 0
          ),
        add constraint "wager_transactions_currency_format_check"
          check ("currency" ~ '^[A-Z]{3}$'),
        add constraint "wager_transactions_idempotency_key_unique"
          unique ("idempotency_key"),
        add constraint "wager_transactions_provider_external_id_unique"
          unique ("provider_id", "external_transaction_id"),
        add constraint "wager_transactions_reference_required_check"
          check (
            "kind" not in ('REFUND', 'ROLLBACK')
            or "reference_external_transaction_id" is not null
          ),
        add constraint "wager_transactions_pending_reference_kind_check"
          check (
            "status" <> 'PENDING_REFERENCE'
            or "kind" in ('REFUND', 'ROLLBACK')
          );
    `);

    this.addSql(`
      create unique index "wager_transactions_reversal_once_idx"
        on "wager_transactions" (
          "provider_id",
          "kind",
          "reference_external_transaction_id"
        )
        where "kind" in ('REFUND', 'ROLLBACK')
          and "reference_external_transaction_id" is not null;
    `);

    this.addSql(`
      create index "wager_transactions_pending_reference_idx"
        on "wager_transactions" ("created_at", "id")
        where "status" = 'PENDING_REFERENCE';
    `);

    this.addSql(`
      alter table "wallet_ledger_entries"
        add constraint "wallet_ledger_entries_wallet_transaction_unique"
          unique ("wallet_id", "transaction_id"),
        add constraint "wallet_ledger_entries_direction_check"
          check ("direction" in ('DEBIT', 'CREDIT')),
        add constraint "wallet_ledger_entries_amount_positive_check"
          check ("amount" > 0),
        add constraint "wallet_ledger_entries_currency_format_check"
          check ("currency" ~ '^[A-Z]{3}$'),
        add constraint "wallet_ledger_entries_balance_before_non_negative_check"
          check ("balance_before" >= 0),
        add constraint "wallet_ledger_entries_balance_after_non_negative_check"
          check ("balance_after" >= 0),
        add constraint "wallet_ledger_entries_balance_transition_check"
          check (
            "direction" not in ('DEBIT', 'CREDIT')
            or (
              "direction" = 'CREDIT'
              and "balance_after" = "balance_before" + "amount"
            )
            or (
              "direction" = 'DEBIT'
              and "balance_after" = "balance_before" - "amount"
            )
          );
    `);

    this.addSql(`
      create index "wallet_ledger_entries_wallet_created_id_idx"
        on "wallet_ledger_entries" ("wallet_id", "created_at" desc, "id" desc);
    `);

    this.addSql(`
      create function "reject_wallet_ledger_entry_mutation"()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'wallet_ledger_entries are immutable';
      end;
      $$;
    `);

    this.addSql(`
      create trigger "wallet_ledger_entries_immutable"
      before update or delete on "wallet_ledger_entries"
      for each row
      execute function "reject_wallet_ledger_entry_mutation"();
    `);

    this.addSql(`
      alter table "outbox_messages"
        add constraint "outbox_messages_attempts_non_negative_check"
          check ("attempts" >= 0);
    `);

    this.addSql(`
      create index "outbox_messages_unpublished_due_idx"
        on "outbox_messages" ("next_attempt_at", "occurred_at", "id")
        where "published_at" is null;
    `);
  }

  override down(): void | Promise<void> {
    this.addSql('drop index if exists "outbox_messages_unpublished_due_idx";');
    this.addSql(`
      alter table "outbox_messages"
        drop constraint if exists "outbox_messages_attempts_non_negative_check";
    `);

    this.addSql(`
      drop trigger if exists "wallet_ledger_entries_immutable"
        on "wallet_ledger_entries";
    `);
    this.addSql(`
      drop function if exists "reject_wallet_ledger_entry_mutation"();
    `);
    this.addSql(`
      drop index if exists "wallet_ledger_entries_wallet_created_id_idx";
    `);
    this.addSql(`
      alter table "wallet_ledger_entries"
        drop constraint if exists "wallet_ledger_entries_balance_transition_check",
        drop constraint if exists "wallet_ledger_entries_balance_after_non_negative_check",
        drop constraint if exists "wallet_ledger_entries_balance_before_non_negative_check",
        drop constraint if exists "wallet_ledger_entries_currency_format_check",
        drop constraint if exists "wallet_ledger_entries_amount_positive_check",
        drop constraint if exists "wallet_ledger_entries_direction_check",
        drop constraint if exists "wallet_ledger_entries_wallet_transaction_unique";
    `);

    this.addSql(`
      drop index if exists "wager_transactions_pending_reference_idx";
    `);
    this.addSql(`
      drop index if exists "wager_transactions_reversal_once_idx";
    `);
    this.addSql(`
      alter table "wager_transactions"
        drop constraint if exists "wager_transactions_pending_reference_kind_check",
        drop constraint if exists "wager_transactions_reference_required_check",
        drop constraint if exists "wager_transactions_provider_external_id_unique",
        drop constraint if exists "wager_transactions_idempotency_key_unique",
        drop constraint if exists "wager_transactions_currency_format_check",
        drop constraint if exists "wager_transactions_observed_balance_non_negative_check",
        drop constraint if exists "wager_transactions_amount_non_negative_check",
        drop constraint if exists "wager_transactions_status_check",
        drop constraint if exists "wager_transactions_kind_check",
        drop column if exists "observed_balance";
    `);

    this.addSql(`
      alter table "wallets"
        drop constraint if exists "wallets_currency_format_check",
        drop constraint if exists "wallets_version_positive_check",
        drop constraint if exists "wallets_balance_non_negative_check",
        drop constraint if exists "wallets_player_id_currency_unique";
    `);
  }
}
