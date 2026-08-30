# Database constraints

Este documento descreve os cenários de integração que validam as invariantes aplicadas diretamente pelo PostgreSQL.

A suíte está localizada em `test/database-constraints.spec.ts` e verifica as constraints, índices únicos e triggers adicionados pelas migrations.

## Test conventions

Os testes utilizam uma instância real do PostgreSQL através da configuração do MikroORM do projeto.

Não são utilizados mocks para simular o comportamento do banco. Cada cenário executa comandos SQL reais e confirma que o PostgreSQL aceita estados válidos ou rejeita estados que violam uma invariante.

As fixtures utilizam UUIDs e timestamps fixos. Valores monetários são sempre enviados como strings decimais, como `75.00` e `-0.01`, sem utilização de `number` para representar dinheiro.

Antes de cada teste, as tabelas abaixo são limpas com `TRUNCATE ... CASCADE`:

- `wallets`;
- `wager_transactions`;
- `wallet_ledger_entries`;
- `inbox_messages`;
- `outbox_messages`.

Os casos de rejeição verificam tanto a falha da operação quanto o nome da constraint, índice ou mensagem do trigger responsável pela proteção.

## Execution

A suíte faz parte de `bun test` e depende do PostgreSQL real com as migrations
aplicadas.

```bash
bun run docker:up
bunx mikro-orm migration:up
bun test
```

`bun run test:database` permanece disponível apenas como atalho para executar
esse arquivo isoladamente.

---

## Valid rows

Valida que as constraints não bloqueiam estados permitidos pelo modelo atual.

Cenários:

- insere uma wallet válida;
- insere uma transação processada com `observed_balance` igual a `75.00`;
- preserva exatamente a representação decimal de `observed_balance` retornada pelo PostgreSQL;
- insere um lançamento de ledger balanceado;
- permite `REFUND` e `ROLLBACK` com referência e status `PENDING_REFERENCE`;
- permite `WIN` com valor zero e referência opcional;
- insere mensagens válidas no inbox e no outbox.

Esse cenário positivo protege a migration contra constraints excessivamente restritivas.

---

## Wallets

Valida as invariantes persistentes da tabela `wallets`.

Cenários:

- rejeita a repetição da combinação `player_id` e `currency`;
- rejeita saldo negativo;
- rejeita `version` menor que `1`;
- rejeita moeda fora do formato de três letras maiúsculas.

A unicidade por jogador e moeda impede a criação de duas wallets equivalentes para o mesmo jogador.

As validações de saldo e versão garantem que estados inválidos não possam ser persistidos mesmo quando a escrita não passa pelas entidades de domínio.

---

## Wager transactions

Valida as invariantes persistentes da tabela `wager_transactions`.

Cenários:

- rejeita tipos fora de `OPENING`, `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`;
- rejeita status fora de `PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED` e `FAILED`;
- rejeita valor negativo;
- rejeita `observed_balance` negativo;
- rejeita moeda fora do formato de três letras maiúsculas;
- rejeita `idempotency_key` duplicada;
- rejeita a repetição da combinação `provider_id` e `external_transaction_id`;
- rejeita `REFUND` e `ROLLBACK` sem `reference_external_transaction_id`;
- rejeita `PENDING_REFERENCE` para tipos diferentes de `REFUND` e `ROLLBACK`;
- rejeita uma segunda reversão do mesmo tipo para a mesma referência dentro do mesmo provider.

### Observed balance

`observed_balance` representa o saldo observado após o processamento de uma transação.

O campo é opcional, portanto `NULL` é permitido. Quando informado, seu valor deve ser maior ou igual a zero.

Os testes comprovam os dois lados relevantes dessa regra: um valor válido é persistido com sua escala decimal preservada, enquanto `-0.01` é rejeitado pela constraint `wager_transactions_observed_balance_non_negative_check`.

### Idempotency

A `idempotency_key` é globalmente única na tabela.

A identidade externa da operação também é protegida pela combinação única de `provider_id` e `external_transaction_id`.

Essas constraints impedem duplicações persistentes mesmo quando múltiplas instâncias tentam gravar a mesma identidade. Além das inserções sequenciais desta suíte, a concorrência idempotente é validada com 50 execuções paralelas em PostgreSQL.

### References and reversals

`REFUND` e `ROLLBACK` exigem uma referência externa. O status `PENDING_REFERENCE` também fica restrito a esses dois tipos.

Um índice único parcial impede que o mesmo provider registre mais de um `REFUND PROCESSED` ou mais de um `ROLLBACK PROCESSED` para a mesma referência. Reversões rejeitadas permanecem auditáveis e não bloqueiam uma tentativa corrigida.

---

## Wallet ledger entries

Valida a consistência financeira e a imutabilidade da tabela `wallet_ledger_entries`.

Cenários:

- rejeita a repetição da combinação `wallet_id` e `transaction_id`;
- rejeita valor zero ou negativo;
- rejeita direção diferente de `DEBIT` e `CREDIT`;
- rejeita moeda fora do formato de três letras maiúsculas;
- rejeita `balance_before` negativo;
- rejeita `balance_after` negativo;
- rejeita aritmética incorreta para créditos;
- rejeita aritmética incorreta para débitos;
- rejeita alterações em lançamentos existentes;
- rejeita a exclusão de lançamentos existentes.

Para créditos, o PostgreSQL exige:

```text
balance_after = balance_before + amount
```

Para débitos, o PostgreSQL exige:

```text
balance_after = balance_before - amount
```

A imutabilidade é protegida por um trigger que bloqueia operações de `UPDATE` e `DELETE` com a mensagem `wallet_ledger_entries are immutable`.

---

## Outbox messages

Valida que `outbox_messages.attempts` não aceite valores negativos.

O contador pode começar em zero e aumentar conforme novas tentativas de publicação forem realizadas, mas nunca pode representar uma quantidade negativa de tentativas.

---

## Test boundaries

Esta suíte comprova que o PostgreSQL aplica as invariantes cobertas mesmo quando as escritas são executadas diretamente por SQL.

Ela não valida isoladamente:

- repositories;
- atomicidade dos use cases;
- lock por wallet;
- corridas entre múltiplas instâncias;
- inbox e outbox como fluxo de processamento;
- consumo, retry e DLQ do SQS;
- endpoints HTTP.

Atomicidade, lock e concorrência são cobertos pelas suítes de integração específicas. Mensageria e SQS continuam fora do escopo implementado.
