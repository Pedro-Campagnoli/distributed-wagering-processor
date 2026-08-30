# POST /wallets

## Goal

Validate the HTTP wallet creation flow using the real NestJS application and PostgreSQL database.

The suite verifies that the HTTP layer correctly delegates wallet creation to `OpenWalletUseCase` without duplicating business rules in the controller.

## Run

```bash
bun run test:wallets
```

The suite is opt-in because it requires a real PostgreSQL instance.

## Coverage

The integration tests cover:

- wallet creation with zero initial balance;
- wallet creation with positive initial balance;
- creation of the internal `OPENING` transaction;
- creation of the corresponding `CREDIT` ledger entry;
- invalid HTTP payloads returning `400 Bad Request`;
- invalid money amount and currency returning `400 Bad Request`;
- duplicate `playerId + currency` returning `409 Conflict`.

## Integration scope

The tests use:

- the real NestJS application;
- `ValidationPipe`;
- the global HTTP exception filter;
- the real `OpenWalletUseCase`;
- the real MikroORM repositories;
- a real PostgreSQL database.

Repositories and use cases are not mocked.

Before each test, the database tables are truncated so every test runs in isolation.

## Responsibility boundaries

The controller is responsible only for:

- validating the HTTP transport shape;
- converting the request money payload into `Money`;
- calling `OpenWalletUseCase`;
- mapping the resulting `Wallet` to the HTTP response.

Wallet opening rules, `OPENING`, ledger creation and SQL atomicity remain inside the application/domain flow.
