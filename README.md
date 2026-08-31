# Distributed Wagering Processor

Backend do desafio técnico da Jungle Gaming, implementado com NestJS, TypeScript,
MikroORM, PostgreSQL e Bun.

O projeto cobre a API HTTP obrigatória, processamento financeiro atômico,
concorrência por wallet, idempotência, reversões e referências fora de ordem. O
mesmo fluxo financeiro é usado pelo consumer SQS, com Inbox persistente e
Transactional Outbox.
A descrição das decisões está em [ARCHITECTURE.md](./ARCHITECTURE.md).

## Requisitos

- Bun;
- Docker com Docker Compose.

Os testes de integração usam PostgreSQL e LocalStack reais. Os dois serviços precisam
estar disponíveis; a suíte não é ocultada por variáveis de ambiente nem substituída
por mocks.

## Setup

```bash
cp .env.example .env
bun install
bun run docker:up
bun run migration:up
```

O Compose sobe PostgreSQL 17 e LocalStack. O init do LocalStack cria
`wager-transactions.fifo`, sua DLQ e `wager-events.fifo`; não é necessária conta
AWS. Aguarde os dois containers ficarem `healthy` antes da primeira migration.

## Comandos

```bash
bun run start:dev   # aplicação em modo de desenvolvimento
bun run start:prod  # executa dist/ após bun run build
bun test            # suíte completa, incluindo PostgreSQL e LocalStack
bun run build       # compilação NestJS/TypeScript
bun run lint        # análise estática
bun run migration:up
bun run migration:down
bun run docker:down # encerra PostgreSQL e LocalStack
```

Os scripts `test:money`, `test:wallet`, `test:ledger`, `test:wager`,
`test:database`, `test:repositories`, `test:open-wallet` e `test:wallets`
continuam disponíveis para execução focada durante o desenvolvimento. Eles não
substituem `bun test` como verificação completa.

## Estado atual

Implementado:

- `Money` decimal e invariantes de wallet/ledger;
- abertura de wallet pelo endpoint `POST /wallets`;
- consultas de wallet, ledger e wager transactions;
- submissão HTTP de wager com `Idempotency-Key` obrigatório;
- reconciliação somente de leitura por ledger;
- health checks separados em `/health/live` e `/health/ready`;
- logs JSON contextuais e métricas simples em `/metrics`;
- transação PostgreSQL única para cada fluxo financeiro;
- lock pessimista de escrita por wallet;
- idempotência persistente com SHA-256 canônico calculado internamente e replay
  com `observedBalance`;
- processamento de `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`;
- `PENDING_REFERENCE` e worker local com retry exponencial;
- filas FIFO locais `wager-transactions.fifo` e `wager-transactions-dlq.fifo`;
- producer e consumer com envelope SQS obrigatório, Inbox por `messageId` lógico,
  redelivery seguro, backoff exponencial e redrive para DLQ;
- Transactional Outbox e publisher para a fila FIFO `wager-events.fifo`;
- eventos `WagerTransactionProcessed`, `WagerTransactionRejected`,
  `WalletBalanceChanged` e `WagerTransactionPendingReference`;
- testes unitários, HTTP, integração, migrations e concorrência em PostgreSQL e LocalStack.

Os testes de recovery encerram processos Bun reais depois do commit/antes do ACK e
durante uma publicação da Outbox, validando a retomada por outra instância.

Ainda pendente:

- processamento da DLQ e integração com uma conta AWS real;
- autenticação, por decisão de escopo documentada;
- agregação externa das métricas e observabilidade distribuída.

A Inbox e a Outbox participam da mesma transação raiz do fluxo SQS. A publicação
da Outbox acontece somente depois do commit e segue entrega at-least-once. Os
shutdown hooks aguardam o processamento em voo antes de encerrar os workers.

## Endpoints

```text
POST /wallets
GET  /wallets/:walletId
GET  /wallets/:walletId/ledger?cursor=...&limit=50
POST /wallets/:walletId/reconciliation
POST /wagering/transactions
GET  /wagering/transactions/:transactionId
GET  /providers/:providerId/wagering/transactions/:externalTransactionId
GET  /health/live
GET  /health/ready
GET  /metrics
```

`POST /wagering/transactions` exige o header `Idempotency-Key`. Primeira execução
processada retorna `201`, replay retorna `200`, referência pendente retorna `202`,
rejeição financeira retorna `422`, conflito idempotente retorna `409` e
indisponibilidade de infraestrutura retorna `503`.

## Documentação

- [Arquitetura e decisões técnicas](./ARCHITECTURE.md)
- [Estratégia e cobertura de testes](./docs/testing/README.md)
