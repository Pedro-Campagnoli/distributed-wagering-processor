# Testing Strategy

`bun test` executa toda a suíte, incluindo os testes de integração com PostgreSQL e
LocalStack. Antes de executar, suba os serviços e aplique as migrations:

```bash
bun run docker:up
bunx mikro-orm migration:up
bun test
```

Não existem variáveis de ambiente para habilitar essas suítes. Se PostgreSQL ou
LocalStack estiverem indisponíveis, o comando falha explicitamente.

## Domain

- [Money](./domain/money.md)
- [Wallet](./domain/wallet.md)
- [WalletLedgerEntry](./domain/wallet-ledger-entry.md)
- [WagerTransaction](./domain/wager-transaction.md)

## Application

- [OpenWalletUseCase](./application/open-wallet.md)
- [ProcessWagerTransactionUseCase](./application/process-wager-transaction.md)

## Database

- [Database constraints](./database/database-constraints.md)

## HTTP

- [Wallets](./http/wallets.md)
