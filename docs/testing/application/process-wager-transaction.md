# ProcessWagerTransactionUseCase

`ProcessWagerTransactionUseCase` coordena o processamento de transações de aposta recebidas pelo sistema.

O use case é responsável por validar a wallet associada à transação, criar a `WagerTransaction` e aplicar o comportamento correspondente ao tipo da operação.

A implementação é incremental. Neste momento, o fluxo cobre a criação base de transações e o processamento de `BET`.

## Transaction creation

O use case recebe os dados necessários para criar uma `WagerTransaction`, incluindo:

- provider;
- identificadores externos;
- idempotency key;
- payload hash;
- wallet;
- player;
- round;
- game;
- tipo da transação;
- valor monetário;
- referência externa, quando aplicável.

Transações recebidas externamente são criadas inicialmente pelo domínio através de `WagerTransaction.create()`.

`OPENING` não pode ser submetida externamente.

Essa operação é interna ao sistema e é utilizada durante a abertura de uma wallet.

Os testes verificam:

- criação de uma transação pendente para tipos ainda não processados;
- rejeição de `OPENING` recebido externamente.

## Wallet validation

Antes de processar uma operação financeira, o use case busca a wallet informada.

A wallet precisa:

- existir;
- pertencer ao `playerId` informado na transação.

Quando a wallet não existe, o processamento é interrompido com `WalletNotFoundError`.

Quando a wallet pertence a outro player, o processamento é interrompido com `WalletPlayerMismatchError`.

Essas validações impedem que uma transação seja aplicada a uma wallet inexistente ou pertencente a outro jogador.

## BET

Uma operação `BET` representa um débito na wallet.

O fluxo é:

```text
BET
 ↓
buscar wallet
 ↓
validar player
 ↓
debitar saldo
 ↓
saldo suficiente?
 ├── sim → PROCESSED + DEBIT ledger
 └── não → REJECTED
```

### BET processed

Quando existe saldo suficiente:

- a wallet é debitada;
- a `WagerTransaction` é marcada como `PROCESSED`;
- um `WalletLedgerEntry` é criado;
- a direção do ledger é `DEBIT`.

Exemplo:

```text
Balance before: 100.00 BRL
BET:             25.00 BRL
Balance after:   75.00 BRL
```

O ledger registra:

```text
Direction:       DEBIT
Balance before:  100.00 BRL
Amount:           25.00 BRL
Balance after:    75.00 BRL
```

Os testes verificam:

- status `PROCESSED`;
- saldo atualizado corretamente;
- criação do ledger;
- direção `DEBIT`;
- `balanceBefore`;
- valor da operação;
- `balanceAfter`.

### Insufficient balance

Quando o saldo da wallet é insuficiente:

- a transação é marcada como `REJECTED`;
- o saldo da wallet permanece inalterado;
- nenhum ledger é criado.

Exemplo:

```text
Balance: 100.00 BRL
BET:     150.00 BRL
```

Resultado:

```text
Transaction: REJECTED
Wallet:      100.00 BRL
Ledger:      none
```

Os testes garantem que uma operação rejeitada não produz efeito financeiro parcial.

## Current scope

O processamento atual ainda ocorre apenas em memória dentro do fluxo da aplicação.

Persistência coordenada, transações SQL e locks concorrentes serão adicionados posteriormente.

A separação atual permite validar as regras do processamento antes da introdução das preocupações de infraestrutura e concorrência.
