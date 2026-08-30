# Arquitetura

## Escopo atual

O projeto organiza o domínio de wagering em quatro camadas:

```text
src/wagering/
├── domain/          entidades, value objects e regras financeiras
├── application/     use cases e portas de repositories
├── infrastructure/  MikroORM, PostgreSQL e worker agendado
└── presentation/    controller, DTOs e filtro HTTP
```

O domínio não depende do NestJS nem do MikroORM. Os use cases coordenam regras e
persistência; adapters de infraestrutura convertem domínio e ORM por meio de
mappers explícitos.

## Dinheiro e precisão

`Money` representa valor e moeda. Valores entram como string no formato decimal
com exatamente duas casas (`100.00`) e moedas seguem três letras maiúsculas
(`BRL`). O cálculo usa `decimal.js`; dinheiro não é convertido para `number`.

As operações retornam novas instâncias de `Money` e validam a igualdade de moeda.
Na persistência, valores monetários usam `numeric(20,2)` e os mappers mantêm a
representação como string. Assim, domínio e PostgreSQL preservam a precisão de
centavos sem erros de ponto flutuante.

## Modelo financeiro

### Wallet

`Wallet` mantém `playerId`, moeda, saldo e versão. Crédito e débito:

- recusam valores negativos e moedas incompatíveis;
- ignoram movimentação zero;
- incrementam a versão somente quando o saldo muda;
- impedem débito superior ao saldo.

Existe no máximo uma wallet por `playerId + currency`, protegida por constraint.

### WagerTransaction

`WagerTransaction` registra a intenção e o resultado do processamento. Os tipos
atuais são `OPENING`, `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`; os estados são
`PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED` e `FAILED`.

A entidade persiste as identidades externa e idempotente, `payloadHash`, valor,
contexto da aposta, referência resolvida, resultado, `observedBalance` e metadados
de retry. `OPENING` é uma operação interna criada apenas na abertura da wallet.

### WalletLedgerEntry

O ledger é o histórico imutável dos efeitos de saldo. Cada entrada contém direção
`CREDIT` ou `DEBIT`, valor, `balanceBefore` e `balanceAfter`. A factory valida a
equação financeira, e o PostgreSQL repete essa proteção com constraints e impede
`UPDATE`/`DELETE` por trigger.

Cada movimentação de saldo produz exatamente um ledger associado à transação.
Operações rejeitadas, pendentes, `LOSS` e valores zero não produzem lançamento.
Nos testes financeiros, o saldo da wallet é sempre comparado ao saldo reconstruído
a partir do ledger.

## Atomicidade PostgreSQL

`OpenWalletUseCase` e `ProcessWagerTransactionUseCase` delimitam suas escritas com
`EntityManager.transactional()`. Para uma nova wager transaction, o fluxo é:

```text
BEGIN
  lê e bloqueia a wallet
  aplica as regras de domínio
  persiste WagerTransaction
  atualiza Wallet, quando há efeito financeiro
  persiste WalletLedgerEntry, quando há efeito financeiro
COMMIT
```

Dentro do callback, os repositories existentes são instanciados com o mesmo
`EntityManager` transacional. Os `flush()` dos repositories enviam alterações ao
banco, mas não controlam o commit; o commit ou rollback pertence ao
`transactional()`. Qualquer erro em uma etapa desfaz o conjunto completo. Na
abertura, wallet, transação interna `OPENING` e ledger inicial também compartilham
uma única transação, mas não há wallet existente para bloquear.

## Concorrência por wallet

A wallet é carregada com `LockMode.PESSIMISTIC_WRITE`, equivalente a
`SELECT ... FOR UPDATE`. O lock existe apenas durante a transação atual e serializa
operações que disputam a mesma wallet.

O cenário PostgreSQL `BET 80 + BET 80` inicia uma wallet com `100.00 BRL` e dispara
as duas operações com `Promise.all()` e `EntityManager.fork()` independentes. O
resultado comprovado é uma BET `PROCESSED`, uma `REJECTED` por
`INSUFFICIENT_BALANCE`, saldo final `20.00` e apenas um ledger `DEBIT` de `80.00`.

Esse lock também protege `REFUND`, `ROLLBACK` e retries. Após esperar pelo lock, o
fluxo relê o estado relevante antes de decidir, evitando aplicar uma decisão feita
com dados anteriores à espera.

## Idempotência e replay

Antes do processamento, o use case procura a `idempotencyKey` no PostgreSQL:

- chave inexistente: processa e persiste normalmente;
- mesma chave e mesmo `payloadHash`: retorna a transação existente sem novo efeito;
- mesma chave e hash diferente: lança `IdempotencyConflictError`.

Há uma segunda leitura após adquirir o lock da wallet. Ela fecha a corrida entre
requisições idênticas que passaram juntas pela primeira leitura. As constraints
únicas de `idempotency_key` e `provider_id + external_transaction_id` permanecem
como proteção final do banco.

Na primeira execução, `observedBalance` recebe o saldo resultante e é persistido na
transação. Um replay retorna esse valor original diretamente da transação existente:
não relê a wallet e não retorna uma wallet ou ledger novos. Portanto o resultado do
replay não muda mesmo que operações posteriores alterem o saldo atual.

O teste de carga idempotente dispara 50 chamadas iguais em paralelo, cada uma com
um `EntityManager.fork()` próprio. Todas retornam o mesmo id de transação e o mesmo
`observedBalance`; o PostgreSQL termina com uma transação de wagering, um efeito no
ledger e uma única alteração de saldo.

## Efeito das operações

| Operação | Efeito quando processada | Ledger |
| --- | --- | --- |
| `OPENING` positivo | define o saldo inicial | `CREDIT` |
| `BET` | débito | `DEBIT` |
| `WIN` | crédito | `CREDIT` |
| `LOSS` | nenhum | nenhum |
| `REFUND` de `BET` | crédito | `CREDIT` |
| `ROLLBACK` de `BET` | crédito | `CREDIT` |
| `ROLLBACK` de `WIN` ou `REFUND` | débito | `DEBIT` |

### REFUND

Exige `referenceExternalTransactionId`. A referência deve ser uma `BET PROCESSED`
do mesmo provider, player, wallet, moeda e round, com exatamente o mesmo valor.
Somente um `REFUND PROCESSED` pode existir para a mesma referência. Tentativas
rejeitadas ficam registradas, mas não bloqueiam uma nova operação corrigida.

### ROLLBACK

Também exige referência processada e compatível, com o mesmo valor. Pode reverter
`BET`, `WIN` ou `REFUND`, sempre aplicando o efeito inverso. Somente um
`ROLLBACK PROCESSED` pode existir para a mesma referência. Se o efeito inverso
exigir um débito sem saldo, a operação é rejeitada sem ledger.

## Referências pendentes e retries

Se a referência de um `REFUND` ou `ROLLBACK` ainda não existir, a transação é
persistida como `PENDING_REFERENCE`, sem alterar a wallet e sem criar ledger. O
replay idempotente retorna essa mesma transação.

`PendingReferenceWorker` consulta até 100 pendências vencidas por ciclo, a cada
segundo. Cada tentativa reutiliza `reprocessPending()`, uma nova transação SQL e o
mesmo lock pessimista da wallet. Se a referência aparecer, a transação existente é
atualizada para `PROCESSED`, recebe `referenceTransactionId`, `processedAt` e
`observedBalance`, e cria no máximo um ledger.

Política atual:

- primeira verificação agendada 1 segundo após a criação;
- as quatro primeiras tentativas sem referência reagendam em 2 s, 4 s, 8 s e
  16 s;
- a quinta tentativa sem referência encerra o retry;
- ao atingir esse limite: `REJECTED / REFERENCE_NOT_FOUND_AFTER_RETRIES`.

O worker evita sobreposição dentro da mesma instância. Entre instâncias, todas
podem encontrar o mesmo item na consulta inicial; o lock da wallet serializa o
processamento e `nextReferenceRetryAt` é validado novamente depois do lock. Uma
instância atrasada não incrementa attempts nem reaplica um efeito já concluído.

A migration de hardening preenche `next_reference_retry_at` de pendências antigas
que estejam com `NULL`, e possui operação reversa.

## SQS local

O Compose executa LocalStack com somente o serviço SQS. O init hook
`docker/localstack/init-sqs.sh` cria:

- `wager-transactions.fifo`, fila principal FIFO;
- `wager-transactions-dlq.fifo`, dead-letter queue FIFO;
- redrive da principal para a DLQ após 3 recebimentos sem ACK.

Ambas usam content-based deduplication. O producer envia o contrato de
`ProcessWagerTransactionInput` como JSON e usa `walletId` como `MessageGroupId`,
preservando a ordem das mensagens da mesma wallet.

O consumer recebe uma mensagem por vez e delega para
`ProcessInboxWagerMessageUseCase`. Ele não contém regras de saldo, reversão ou
idempotência.

### Inbox e atomicidade

`inbox_messages` usa a chave primária composta `consumer_name + message_id`. O
registro também preserva SHA-256 do payload, horário de recebimento e horário de
processamento.

Para uma nova entrega, o processamento é:

```text
BEGIN
  consulta Inbox por consumerName + messageId
  insere Inbox ainda não processada
  executa ProcessWagerTransactionUseCase
  marca Inbox como processada
COMMIT

DeleteMessage no SQS
```

O processamento financeiro é executado pelo mesmo `EntityManager` da transação
raiz. O `transactional()` interno do use case financeiro cria apenas um savepoint;
o commit definitivo continua pertencendo ao bloco externo da Inbox. Assim, uma
falha na Inbox desfaz wallet, WagerTransaction e ledger, e uma falha financeira
também desfaz a Inbox.

`DeleteMessage` é enviado somente depois que o callback transacional retorna e o
commit termina. Se o ACK falhar nesse intervalo, a próxima entrega encontra a Inbox
com `processed_at`, não chama novamente o fluxo financeiro e apenas confirma a
mensagem.

Rejeições de negócio representadas por `WagerTransaction REJECTED` são resultados
terminais normais: Inbox e resultado são persistidos e a mensagem recebe ACK.
Exceções de processamento ou infraestrutura provocam rollback e não recebem ACK.
O retry depende apenas do visibility timeout e do redrive do SQS; não existe loop de
retry manual na aplicação. Após três recebimentos sem sucesso, a mensagem vai para
a DLQ.

Endpoint, região, credenciais locais e URLs das filas vêm de variáveis de ambiente.
As credenciais `test/test` são fictícias e o endpoint aponta para o LocalStack; não
é necessária uma conta AWS.

## Failure codes

Rejeições esperadas são persistidas na `WagerTransaction` e não alteram saldo nem
ledger.

| Código | Situação |
| --- | --- |
| `CURRENCY_MISMATCH` | moeda da operação difere da wallet |
| `INVALID_AMOUNT` | valor não produz movimentação válida |
| `INSUFFICIENT_BALANCE` | BET excede o saldo |
| `INVALID_REFERENCE_KIND` | tipo da referência não é permitido |
| `REFERENCE_NOT_PROCESSED` | referência existe, mas não foi processada |
| `REFERENCE_DATA_MISMATCH` | provider/player/wallet/moeda/round incompatível |
| `REFERENCE_AMOUNT_MISMATCH` | valor difere da referência |
| `REFERENCE_ALREADY_REFUNDED` | já existe REFUND processado da referência |
| `REFERENCE_ALREADY_ROLLED_BACK` | já existe ROLLBACK processado da referência |
| `ROLLBACK_INSUFFICIENT_BALANCE` | efeito inverso deixaria saldo negativo |
| `REFERENCE_NOT_FOUND_AFTER_RETRIES` | referência ausente após 5 tentativas |

Falhas anteriores à criação de uma transação válida continuam como erros da
aplicação: wallet inexistente, player incompatível, referência obrigatória ausente,
`OPENING` externo e conflito de idempotência.

## Garantias e limites atuais

Implementado e verificado em PostgreSQL e LocalStack reais:

- precisão monetária e constraints financeiras;
- atomicidade wallet/transação/ledger;
- exclusão mútua por wallet;
- replay idempotente e concorrência de 50 chamadas;
- unicidade de reversões efetivamente processadas;
- retry concorrente de referências pendentes;
- reconstrução do saldo pelo ledger nas fixtures financeiras;
- criação das filas FIFO, redrive, envio e consumo;
- Inbox atômica com o efeito financeiro e redelivery após falha de ACK;
- rejeição terminal com ACK e falhas repetidas encaminhadas à DLQ.

Limitações conhecidas do checkpoint atual:

- o lock serializa por wallet, podendo limitar throughput em wallets muito ativas;
- o worker usa polling local e não reserva lotes antes da execução; a correção entre
  instâncias depende do lock e da revalidação transacional;
- a política de retry é fixa em código, sem configuração operacional ou jitter;
- o SQS está integrado apenas ao LocalStack; não há configuração de deploy AWS;
- não há Outbox, extensão dinâmica de visibility timeout ou processamento da DLQ;
- o consumer atual processa uma mensagem por polling e não possui observabilidade avançada;
- não há teste distribuído entre processos/hosts: a concorrência atual usa conexões
  PostgreSQL e `EntityManager.fork()` independentes no mesmo processo de teste.
