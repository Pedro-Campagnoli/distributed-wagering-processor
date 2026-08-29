# WalletLedgerEntry

Este documento descreve os cenários de teste e as principais decisões de domínio relacionadas ao `WalletLedgerEntry`.

O ledger representa o histórico imutável das alterações de saldo de uma wallet.

Cada entrada registra:

- a wallet afetada;
- a transação responsável pela movimentação;
- a direção da operação;
- o valor movimentado;
- o saldo antes da operação;
- o saldo depois da operação;
- o momento em que o lançamento foi criado.

## Creation

Valida a criação de lançamentos através de `WalletLedgerEntry.create()`.

Cenários:

- cria um lançamento `CREDIT` balanceado;
- cria um lançamento `DEBIT` balanceado;
- rejeita um `CREDIT` cuja aritmética não corresponde aos saldos informados;
- rejeita um `DEBIT` cuja aritmética não corresponde aos saldos informados;
- rejeita valores negativos;
- rejeita movimentações com valor zero.

Uma entrada de ledger representa uma movimentação financeira que realmente alterou o saldo da wallet.

Por isso, o valor movimentado deve ser estritamente positivo.

---

## Balance validation

Todo lançamento precisa ser matematicamente consistente.

Para créditos:

```text
balanceBefore + money = balanceAfter
```

Por exemplo:

```text
balanceBefore: 100.00 BRL
money:          25.00 BRL
balanceAfter:  125.00 BRL
```

Para débitos:

```text
balanceBefore - money = balanceAfter
```

Por exemplo:

```text
balanceBefore: 100.00 BRL
money:          25.00 BRL
balanceAfter:   75.00 BRL
```

O método `isBalanced()` calcula o saldo esperado de acordo com a direção da entrada e compara o resultado com `balanceAfter`.

A factory `create()` utiliza essa validação antes de permitir que uma entrada seja retornada ao domínio.

Quando a aritmética não corresponde aos valores informados, a criação é rejeitada com `UnbalancedLedgerEntryError`.

Por exemplo:

```text
direction:     DEBIT
balanceBefore: 100.00 BRL
money:          25.00 BRL
balanceAfter:   80.00 BRL
```

O lançamento é inválido, pois:

```text
100.00 - 25.00 = 75.00
```

e não `80.00`.

---

## Ledger amount

O valor registrado em `money` deve ser maior que zero.

Embora o value object `Money` possa representar valores negativos produzidos internamente por operações como `negate()`, o ledger utiliza `money` como a magnitude da movimentação.

O sentido financeiro é determinado por `LedgerDirection`:

- `CREDIT` representa aumento do saldo;
- `DEBIT` representa redução do saldo.

Permitir um valor negativo faria com que a combinação entre direção e sinal pudesse inverter implicitamente o significado da operação.

Por exemplo:

```text
CREDIT -25.00
```

poderia produzir matematicamente uma redução de saldo, apesar de a direção declarar um crédito.

Por isso, valores negativos são rejeitados com `InvalidLedgerAmountError`.

### Zero

Movimentações com valor `0.00` também são rejeitadas.

Um lançamento de ledger representa uma alteração efetiva do saldo. Uma operação de valor zero produziria:

```text
balanceBefore = balanceAfter
```

e, portanto, não representaria uma movimentação financeira real.

Essa decisão também mantém o comportamento consistente com a `Wallet`, onde operações de crédito ou débito com valor zero não alteram estado, versão ou timestamp.

---

## Immutability

`WalletLedgerEntry` representa um fato financeiro já ocorrido e, por isso, é estruturalmente imutável.

Todas as suas propriedades são `readonly` e não existem métodos responsáveis por alterar:

- `direction`;
- `money`;
- `balanceBefore`;
- `balanceAfter`;
- `transactionId`;
- `walletId`.

Depois de criado, um lançamento não deve ser modificado para representar outro estado.

Caso uma nova movimentação aconteça, uma nova entrada deve ser criada.

Essa característica permite que o ledger funcione como histórico auditável das alterações de saldo.

---

## Relationship with Wallet

`WalletLedgerEntry` não altera o saldo da wallet.

A movimentação acontece primeiro dentro da própria `Wallet`.

Por exemplo:

```text
Wallet
balance: 100.00 BRL

debit(25.00 BRL)
        ↓
balanceBefore: 100.00 BRL
balanceAfter:   75.00 BRL
```

Esses valores podem então ser utilizados para criar o lançamento correspondente:

```text
WalletLedgerEntry
direction:     DEBIT
money:          25.00 BRL
balanceBefore: 100.00 BRL
balanceAfter:   75.00 BRL
```

O ledger apenas registra e valida o resultado da movimentação.

Essa separação mantém as responsabilidades claras:

- `Wallet` protege e altera o saldo;
- `WalletLedgerEntry` registra de forma imutável a alteração ocorrida.

---

## Rehydration

Valida a reconstrução de uma entrada de ledger previamente persistida através de `WalletLedgerEntry.rehydrate()`.

Cenários:

- restaura `id`;
- restaura `walletId`;
- restaura `transactionId`;
- preserva a direção;
- preserva o valor movimentado;
- preserva `balanceBefore`;
- preserva `balanceAfter`;
- preserva `createdAt`.

`rehydrate()` não representa a criação de uma nova movimentação.

Seu objetivo é apenas reconstruir em memória uma entrada que já havia sido persistida.

Por isso, `createdAt` não é reinicializado e as regras de criação não são reaplicadas durante a reidratação.

---

## Resumo da cobertura

| Área                   | O que é validado                                        | Garantia principal                                                    |
| ---------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| **Credit**             | Criação de lançamento de crédito válido                 | Créditos representam corretamente o aumento do saldo                  |
| **Debit**              | Criação de lançamento de débito válido                  | Débitos representam corretamente a redução do saldo                   |
| **Balance Validation** | Relação entre `money`, saldo anterior e saldo posterior | Lançamentos inconsistentes não entram no domínio                      |
| **Ledger Amount**      | Rejeição de valores negativos e zero                    | Toda entrada representa uma movimentação real e com direção explícita |
| **Immutability**       | Estado sem propriedades ou transições mutáveis          | O ledger permanece auditável após sua criação                         |
| **Rehydration**        | Reconstrução de estado persistido                       | Entradas existentes são restauradas sem reinicialização               |

A suíte atual cobre as principais invariantes de criação e reconstrução do `WalletLedgerEntry`, garantindo que somente movimentações positivas e matematicamente consistentes possam ser criadas.
