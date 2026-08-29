import { Migration } from '@mikro-orm/migrations';

export class Migration20260829234448_initial_schema extends Migration {
  override name = 'Migration20260829234448_initial_schema';

  override up(): void | Promise<void> {
    this.addSql(`
      create table "wallets" (
        "id" uuid not null,
        "player_id" uuid not null,
        "currency" varchar(3) not null,
        "balance" numeric(20, 2) not null,
        "version" integer not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "wallets_pkey" primary key ("id")
      );
    `);

    this.addSql(`
      create table "wager_transactions" (
        "id" uuid not null,
        "provider_id" varchar not null,
        "external_transaction_id" varchar not null,
        "idempotency_key" varchar not null,
        "payload_hash" varchar not null,
        "wallet_id" uuid not null,
        "player_id" uuid not null,
        "round_id" varchar not null,
        "game_id" varchar not null,
        "kind" varchar not null,
        "amount" numeric(20, 2) not null,
        "currency" varchar(3) not null,
        "reference_external_transaction_id" varchar null,
        "reference_transaction_id" uuid null,
        "status" varchar not null,
        "failure_code" varchar null,
        "created_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "wager_transactions_pkey" primary key ("id"),
        constraint "wager_transactions_wallet_id_foreign"
          foreign key ("wallet_id") references "wallets" ("id")
          on delete restrict,
        constraint "wager_transactions_reference_transaction_id_foreign"
          foreign key ("reference_transaction_id") references "wager_transactions" ("id")
          on delete restrict
      );
    `);

    this.addSql(`
      create table "wallet_ledger_entries" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" varchar not null,
        "amount" numeric(20, 2) not null,
        "currency" varchar(3) not null,
        "balance_before" numeric(20, 2) not null,
        "balance_after" numeric(20, 2) not null,
        "created_at" timestamptz not null,
        constraint "wallet_ledger_entries_pkey" primary key ("id"),
        constraint "wallet_ledger_entries_wallet_id_foreign"
          foreign key ("wallet_id") references "wallets" ("id")
          on delete restrict,
        constraint "wallet_ledger_entries_transaction_id_foreign"
          foreign key ("transaction_id") references "wager_transactions" ("id")
          on delete restrict
      );
    `);

    this.addSql(`
      create table "inbox_messages" (
        "message_id" varchar not null,
        "consumer_name" varchar not null,
        "payload_hash" varchar not null,
        "received_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "inbox_messages_pkey"
          primary key ("message_id", "consumer_name")
      );
    `);

    this.addSql(`
      create table "outbox_messages" (
        "id" uuid not null,
        "aggregate_id" uuid not null,
        "event_type" varchar not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null,
        "attempts" integer not null,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        constraint "outbox_messages_pkey" primary key ("id")
      );
    `);
  }

  override down(): void | Promise<void> {
    this.addSql('drop table if exists "outbox_messages";');
    this.addSql('drop table if exists "inbox_messages";');
    this.addSql('drop table if exists "wallet_ledger_entries";');
    this.addSql('drop table if exists "wager_transactions";');
    this.addSql('drop table if exists "wallets";');
  }
}
