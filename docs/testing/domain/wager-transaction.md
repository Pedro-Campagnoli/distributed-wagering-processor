# WagerTransaction

`WagerTransaction` representa uma operação financeira recebida ou criada pelo sistema.

A entidade mantém os dados originais da transação e controla seu ciclo de vida, garantindo que transições inválidas não sejam realizadas.

Os tipos suportados são:

- `OPENING`
- `BET`
- `WIN`
- `LOSS`
- `REFUND`
- `ROLLBACK`

Novas transações são criadas inicialmente com status `PENDING`.

## Creation

A factory `create()` cria uma nova transação com:

- status `PENDING`;
- `createdAt` preenchido;
- `referenceTransactionId` indefinido;
- `failureCode` indefinido;
- `processedAt` indefinido.

Os dados originais da transação são mantidos como propriedades somente leitura.

### References

`REFUND` e `ROLLBACK` obrigatoriamente precisam informar `referenceExternalTransactionId`.

Isso garante que essas operações não possam ser criadas sem identificar a transação externa que pretendem reverter.

`WIN` pode possuir referência, mas ela não é obrigatória.

Os testes verificam:

- criação de uma `BET`;
- criação de `REFUND` com referência;
- criação de `ROLLBACK` com referência;
- rejeição de `REFUND` sem referência;
- rejeição de `ROLLBACK` sem referência;
- criação de `WIN` sem referência.

## State transitions

A entidade controla explicitamente seu ciclo de vida.

Os fluxos permitidos são:

```text
PENDING
├── PROCESSED
├── PENDING_REFERENCE
├── REJECTED
└── FAILED

PENDING_REFERENCE
├── PROCESSED
├── REJECTED
└── FAILED
```

`PENDING_REFERENCE` é aplicável apenas às operações que exigem uma transação referenciada.

Os testes verificam as principais transições válidas e impedem transições incompatíveis com o tipo ou estado atual da transação.

### Pending reference

`markPendingReference()` representa uma transação que depende de outra transação ainda não disponível.

Esse estado é utilizado por operações `REFUND` e `ROLLBACK` recebidas antes da transação referenciada.

A transição permitida é:

```text
REFUND | ROLLBACK

PENDING → PENDING_REFERENCE
```

Operações que não exigem referência, como `BET`, não podem entrar em `PENDING_REFERENCE`.

Uma transação que já está em `PENDING_REFERENCE` também não pode ser marcada novamente com o mesmo estado.

Tentativas de realizar essas transições inválidas lançam `InvalidTransactionStateError`.

### Processed

`markProcessed()` finaliza uma operação executada com sucesso.

A operação:

- altera o status para `PROCESSED`;
- registra `processedAt`;
- registra `referenceTransactionId` quando aplicável.

Para `REFUND` e `ROLLBACK`, uma referência interna deve estar resolvida antes da transação ser marcada como processada.

Os testes utilizam datas fixas para tornar a validação determinística.

### Rejected

`reject()` representa uma operação que não pôde ser aplicada devido a uma regra de negócio.

A operação:

- altera o status para `REJECTED`;
- registra um `failureCode`;
- não preenche `processedAt`.

Exemplos atuais incluem saldo insuficiente, moeda incompatível e reversões inválidas ou duplicadas.

### Failed

`fail()` representa uma falha permanente durante o processamento.

A operação:

- altera o status para `FAILED`;
- registra um `failureCode`;
- não preenche `processedAt`.

`FailureCode` permanece uma string. Os códigos atualmente produzidos pelo fluxo de processamento estão documentados em `ARCHITECTURE.md`.

## Terminal states

Os estados:

- `PROCESSED`;
- `REJECTED`;
- `FAILED`;

são terminais.

Uma transação que chegou a qualquer um desses estados não pode sofrer novas transições.

Tentativas de alterar uma transação terminal lançam `InvalidTransactionStateError`.

Os testes verificam transições inválidas a partir dos três estados terminais.

## Domain queries

Além das transições de estado, a entidade possui pequenos métodos que descrevem características da operação.

### `isTerminal()`

Indica se a transação chegou a um estado terminal.

```text
PENDING           → false
PENDING_REFERENCE → false
PROCESSED         → true
REJECTED          → true
FAILED            → true
```

### `requiresReference()`

Indica se o tipo da transação exige uma referência externa.

```text
OPENING  → false
BET      → false
WIN      → false
LOSS     → false
REFUND   → true
ROLLBACK → true
```

### `matchesPayload()`

Compara o `payloadHash` recebido com o hash armazenado na transação.

Esse comportamento é utilizado pelo tratamento de idempotência para distinguir:

```text
mesma chave + mesmo payload
→ replay

mesma chave + payload diferente
→ conflito
```

Os testes cobrem payloads iguais e diferentes.

### `affectsBalance()`

Indica se aquele tipo de operação possui efeito financeiro quando processado.

```text
OPENING  → true
BET      → true
WIN      → true
LOSS     → false
REFUND   → true
ROLLBACK → true
```

O método descreve o tipo da operação.

Uma `BET` rejeitada, por exemplo, continua sendo uma operação que conceitualmente afeta saldo, embora aquela instância não tenha efetivamente alterado a wallet.

## Ledger direction

`ledgerDirectionFor()` determina a direção do lançamento financeiro associado à transação.

Quando uma direção existe, o método sempre retorna um `LedgerDirection`.

As operações diretas seguem:

```text
OPENING → CREDIT
BET     → DEBIT
WIN     → CREDIT
REFUND  → CREDIT
```

`LOSS` não altera saldo e não gera ledger.

Por isso, `ledgerDirectionFor()` não deve ser utilizado para uma transação `LOSS`. Caso seja chamado nesse contexto, a entidade lança `LedgerDirectionUnavailableError`.

O fluxo esperado é utilizar `affectsBalance()` antes de tentar determinar uma direção financeira.

```text
LOSS
→ affectsBalance() === false
→ nenhuma direção de ledger necessária
```

### Rollback

`ROLLBACK` aplica o efeito financeiro inverso da transação referenciada.

`ledgerDirectionFor()` recebe a própria `WagerTransaction` referenciada, e não apenas seu `kind`.

Isso mantém a relação entre as duas operações explícita e permite que as demais propriedades da referência sejam validadas pelo use case.

Os tipos válidos de referência para `ROLLBACK` são:

```text
BET
WIN
REFUND
```

As direções são:

```text
ROLLBACK de BET

DEBIT → CREDIT


ROLLBACK de WIN

CREDIT → DEBIT


ROLLBACK de REFUND

CREDIT → DEBIT
```

`LOSS` não é uma referência válida para `ROLLBACK`.

Quando uma referência válida ainda não foi resolvida, ou quando seu tipo não possui uma direção válida para rollback, `ledgerDirectionFor()` lança `LedgerDirectionUnavailableError`.

A validação completa da transação referenciada — provider, player, wallet, currency, round, status, valor e duplicidade de reversão — pertence ao processamento da operação e está coberta pelos testes de integração de `REFUND` e `ROLLBACK`.

## Rehydration

`rehydrate()` reconstrói uma transação a partir do estado persistido sem criar um novo ciclo de vida.

Ela preserva exatamente os dados recebidos, incluindo:

- dados de identificação da transação;
- `Money`;
- `createdAt`;
- status;
- referência externa;
- referência interna;
- `failureCode`;
- `processedAt`.

Diferente de `create()`, a reidratação não reaplica regras de criação nem redefine o status para `PENDING`.

Isso é importante porque o estado persistido representa um fato que já ocorreu no sistema.

Por exemplo, uma transação pode ser reconstruída diretamente como:

```text
PROCESSED
REJECTED
FAILED
PENDING_REFERENCE
```

sem executar novamente as transições que originalmente produziram aquele estado.

A reidratação também não reaplica a exigência de `referenceExternalTransactionId` existente em `create()` para `REFUND` e `ROLLBACK`.

Essa decisão segue a separação entre:

```text
create()
→ valida a criação de um novo estado de domínio

rehydrate()
→ restaura um estado que já foi persistido
```

Os testes verificam dois comportamentos principais:

1. o estado persistido completo é reconstruído sem alterações, incluindo referências e timestamps;
2. regras de criação não são executadas novamente durante a reidratação.

Isso garante que a camada de persistência possa reconstruir a entidade sem modificar ou reinterpretar seu histórico.

## Test helpers

Os testes utilizam uma factory local `createTransaction()` com uma `BET` válida como estado padrão.

Cada cenário informa apenas os valores relevantes para aquela regra por meio de overrides.

Isso reduz repetição de setup sem alterar a cobertura ou esconder as regras específicas testadas.

A criação direta com `WagerTransaction.create()` continua sendo utilizada no teste principal da própria factory, tornando explícita a validação de todos os campos iniciais.

## Coverage summary

| Área                                                                                                        | Cenários cobertos                                               | Garantia                                      |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| Creation                                                                                                    | BET, WIN, REFUND e ROLLBACK                                     | Estado inicial válido                         |
| References                                                                                                  | Referência obrigatória em REFUND e ROLLBACK                     | Operações dependentes não nascem incompletas  |
| State transitions                                                                                           | Pending, pending reference, processed, rejected e failed        | Lifecycle controlado                          |
| Pending reference                                                                                           | REFUND/ROLLBACK válidos e tipos sem referência rejeitados       | Estado reservado a operações dependentes      |
| Terminal states                                                                                             | PROCESSED, REJECTED e FAILED                                    | Estados finais são imutáveis                  |
| Payload                                                                                                     | Hash igual e diferente                                          | Base para idempotência persistente            |
| Balance behavior                                                                                            | Todos os transaction kinds                                      | LOSS é identificado como operação sem saldo   |
| Ledger direction                                                                                            | Operações diretas e rollbacks válidos                           | Direção financeira consistente                |
| Invalid ledger direction                                                                                    | LOSS, referência ausente ou inválida                            | Direção nunca é representada de forma ambígua |
| Rehydration                                                                                                 | Estado persistido completo e reconstrução sem regras de criação | Estado restaurado exatamente como persistido  |
| Os testes mantêm `WagerTransaction` independente de persistência, repositories, PostgreSQL, SQS e `Wallet`. |

Essas integrações são verificadas separadamente pelos testes de processamento, persistência e concorrência em PostgreSQL.
