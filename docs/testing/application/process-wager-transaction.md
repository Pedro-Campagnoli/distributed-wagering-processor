# ProcessWagerTransactionUseCase

`ProcessWagerTransactionUseCase` coordena o processamento financeiro de `BET`,
`WIN`, `LOSS`, `REFUND` e `ROLLBACK`. `OPENING` externo é rejeitado, pois essa
operação pertence ao fluxo interno de abertura da wallet.

## Cobertura

Os testes unitários e de integração verificam:

- wallet inexistente e incompatibilidade de player;
- `BET` processada e rejeitada por saldo insuficiente;
- `WIN` como crédito e `LOSS` sem efeito financeiro;
- transação PostgreSQL única e rollback atômico;
- lock pessimista por wallet;
- duas BETs concorrentes de `80.00` sobre saldo `100.00`;
- idempotency key, conflito de payload e replay com `observedBalance`;
- 50 requisições idênticas executadas em paralelo;
- validações, efeitos e duplicidade de `REFUND` e `ROLLBACK`;
- `PENDING_REFERENCE`, backoff e esgotamento de retries;
- múltiplos workers concorrentes sem duplicar attempts ou efeitos;
- ausência de saldo/ledger para operações rejeitadas ou pendentes;
- igualdade entre saldo persistido e saldo reconstruído pelo ledger.

Os testes de integração usam PostgreSQL real, repositories MikroORM reais e um
`EntityManager.fork()` independente para cada operação concorrente.

## Execução

```bash
bun run docker:up
bunx mikro-orm migration:up
bun test
```

A suíte PostgreSQL é executada automaticamente; não existe variável para
habilitá-la. Consulte [ARCHITECTURE.md](../../../ARCHITECTURE.md) para o fluxo
transacional, regras de reversão, política de retries e limitações atuais.
