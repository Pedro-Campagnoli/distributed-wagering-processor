# OpenWalletUseCase

Este documento descreve os testes de integração do fluxo de abertura de wallet.

A suíte está localizada em `test/open-wallet.spec.ts` e valida a persistência coordenada de `Wallet`, da transação interna `OPENING` e do lançamento inicial no ledger.

## Test conventions

Os testes utilizam o PostgreSQL real através da configuração MikroORM do projeto. Repositories e transações não são substituídos por mocks.

Valores monetários são representados por `Money` e verificados como strings decimais, como `0.00` e `100.00`. Nenhuma conversão monetária para `number` é utilizada.

UUIDs determinísticos são injetados nos cenários que precisam inspecionar identidades persistidas ou provocar uma falha específica. O cenário de saldo zero utiliza o gerador padrão e confirma que o identificador produzido é um UUID versão 4.

Antes de cada teste e ao encerrar a suíte, as cinco tabelas do projeto são limpas com `TRUNCATE ... CASCADE`.

## Execution

A suíte faz parte de `bun test` e depende do PostgreSQL real com as migrations
aplicadas.

```bash
bun run docker:up
bunx mikro-orm migration:up
bun test
```

`bun run test:open-wallet` permanece disponível apenas como atalho para executar
esse arquivo isoladamente.

---

## Zero initial balance

Valida a abertura com saldo inicial `0.00 BRL`.

Cenários verificados:

- cria exatamente uma wallet;
- persiste saldo `0.00 BRL`;
- mantém a wallet na versão `1`;
- gera um UUID versão 4 para a wallet;
- não cria uma transação `OPENING`;
- não cria lançamento no ledger.

Saldo zero não representa uma movimentação financeira. Por isso, a wallet existe sem um fato correspondente em `wager_transactions` ou `wallet_ledger_entries`.

---

## Positive initial balance

Valida a abertura com saldo inicial `100.00 BRL`.

Cenários verificados:

- persiste exatamente uma wallet com saldo `100.00 BRL` e versão `1`;
- persiste exatamente uma transação do tipo `OPENING`;
- restaura o valor da transação como `100.00 BRL` sem perda de precisão;
- persiste a transação no estado `PROCESSED` com `processed_at` preenchido;
- persiste exatamente um lançamento `CREDIT`;
- preserva `balance_before = 0.00`;
- preserva `amount = 100.00`;
- preserva `balance_after = 100.00`.

A wallet não recebe um crédito posterior à abertura. `Wallet.open()` já define o saldo inicial e a versão `1`; a transação e o ledger explicam historicamente esse estado.

### Internal OPENING identity

O teste confirma a convenção determinística usada para identificar a operação interna:

- `provider_id = SYSTEM`;
- `external_transaction_id = opening:{walletId}`;
- `idempotency_key = SYSTEM:opening:{walletId}`;
- `round_id = opening:{walletId}`;
- `game_id = SYSTEM`.

O `payload_hash` esperado também é verificado. Ele é um SHA-256 calculado sobre os seguintes campos estáveis, separados por quebra de linha:

```text
OPENING
walletId
playerId
amount
currency
```

Timestamps e valores aleatórios não participam do hash.

### Ledger arithmetic

O lançamento persistido representa a igualdade:

```text
0.00 + 100.00 = 100.00
```

Além das asserções do teste, essa aritmética passa pela factory `WalletLedgerEntry.create()` e pelas constraints financeiras do PostgreSQL.

---

## Atomic rollback

Valida que wallet, `OPENING` e ledger compartilham a mesma transação SQL.

O teste prepara um lançamento existente e injeta seu UUID como o identificador do novo ledger. A sequência executada pelo use case é:

1. insere a nova wallet;
2. insere a nova transação `OPENING`;
3. tenta inserir o ledger com uma chave primária já existente;
4. o PostgreSQL rejeita o terceiro insert através de `wallet_ledger_entries_pkey`.

Após a falha, consultas reais ao banco confirmam que não restou nenhum registro associado à nova wallet:

- zero wallets;
- zero transações;
- zero lançamentos no ledger.

Isso demonstra rollback do bloco inteiro, e não apenas uma validação simulada no teste.

---

## Duplicate wallet

Valida duas tentativas sequenciais de abertura para a mesma combinação de jogador e moeda.

A primeira abertura persiste normalmente a wallet, o `OPENING` e o ledger. A segunda é rejeitada pelo PostgreSQL através da constraint `wallets_player_id_currency_unique`.

Depois da rejeição, o primeiro conjunto permanece íntegro e único:

- uma wallet;
- uma transação;
- um lançamento no ledger.

O teste não utiliza uma consulta prévia como garantia de unicidade. A constraint do PostgreSQL permanece a proteção autoritativa.

---

## Test boundaries

Esta suíte comprova o comportamento de abertura de wallet e sua atomicidade em uma instância real do PostgreSQL.

Ela não cobre ainda:

- endpoint `POST /wallets` ou DTOs HTTP;
- tradução de erros do PostgreSQL para erros da aplicação/API;
- aberturas concorrentes para a mesma wallet;
- atualização ou lock de wallets existentes;
- transações de `BET`, `WIN` ou `LOSS`;
- retry transacional;
- idempotência e replay genéricos.

Esses comportamentos pertencem às etapas posteriores do projeto.
