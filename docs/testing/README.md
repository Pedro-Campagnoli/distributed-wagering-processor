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

Os testes de integração exercitam atomicidade de Inbox/Outbox, backoff e DLQ no
LocalStack, além de migrations `down/up`. Os cenários de recovery encerram processos
Bun reais depois do commit/antes do ACK e antes do envio de uma Outbox; uma nova
instância recupera o estado persistido.

Os testes de concorrência incluem BET `80.00 + 80.00`, 50 replays idempotentes,
wallets diferentes e quatro processos independentes. Os cenários financeiros
reconstroem o saldo pelo ledger como pós-condição.

## HTTP

- [Wallets](./http/wallets.md)
