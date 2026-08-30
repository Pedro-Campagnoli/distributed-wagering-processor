# Distributed Wagering Processor

Backend do desafio técnico da Jungle Gaming, implementado com NestJS, TypeScript,
MikroORM, PostgreSQL e Bun.

O checkpoint atual cobre abertura de wallet, processamento financeiro atômico,
concorrência por wallet, idempotência, `REFUND`, `ROLLBACK` e reprocessamento de
referências pendentes, além de producer/consumer SQS local com Inbox persistente.
O fluxo também possui Transactional Outbox e publicação local dos eventos de
integração.
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
bunx mikro-orm migration:up
```

## Comandos

```bash
bun run start:dev   # aplicação em modo de desenvolvimento
bun test            # suíte completa, incluindo PostgreSQL e LocalStack
bun run build       # compilação NestJS/TypeScript
bun run lint        # análise estática
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
- transação PostgreSQL única para cada fluxo financeiro;
- lock pessimista de escrita por wallet;
- idempotência persistente com SHA-256 canônico calculado internamente e replay
  com `observedBalance`;
- processamento de `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`;
- `PENDING_REFERENCE` e worker local com retry exponencial;
- filas FIFO locais `wager-transactions.fifo` e `wager-transactions-dlq.fifo`;
- producer e consumer com envelope SQS obrigatório, Inbox por `messageId` lógico,
  redelivery seguro e redrive para DLQ;
- Transactional Outbox e publisher para a fila FIFO `wager-events.fifo`;
- eventos `WagerTransactionProcessed`, `WagerTransactionRejected`,
  `WalletBalanceChanged` e `WagerTransactionPendingReference`;
- testes unitários, HTTP, integração, migrations e concorrência em PostgreSQL e LocalStack.

Ainda pendente:

- endpoint HTTP de ingestão de wager transactions;
- processamento da DLQ e integração com uma conta AWS real;
- observabilidade e operação distribuída da mensageria.

A Inbox e a Outbox participam da mesma transação raiz do fluxo SQS. A publicação
da Outbox acontece somente depois do commit e segue entrega at-least-once. Os
shutdown hooks aguardam o processamento em voo antes de encerrar os workers.

## Documentação

- [Arquitetura e decisões técnicas](./ARCHITECTURE.md)
- [Estratégia e cobertura de testes](./docs/testing/README.md)
