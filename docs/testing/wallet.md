# Wallet

Este documento descreve os cenários de teste e as principais decisões de domínio relacionadas ao aggregate root `Wallet`.

## Test conventions

Alguns testes utilizam timestamps fixos para manter a suíte determinística.

Essas datas representam apenas um estado inicial controlado. A implementação continua utilizando `new Date()` para registrar o horário real das alterações, enquanto os testes evitam depender do relógio da execução.

---

## Opening

Valida a criação inicial de uma `Wallet` através de `Wallet.open()`.

Cenários:

- cria uma wallet com `id`, `playerId`, moeda e saldo inicial corretos;
- inicia a `version` em `1`;
- permite a criação de uma wallet com saldo zero;
- rejeita a criação de uma wallet com saldo inicial negativo;
- inicializa `createdAt` e `updatedAt` com o mesmo timestamp.

A moeda da wallet é derivada diretamente do `initialBalance`.

Isso evita manter duas fontes diferentes para a moeda durante a abertura da wallet. O saldo inicial já é representado por uma instância válida de `Money`, portanto a wallet utiliza a moeda contida nesse value object.

Embora `Money` possa representar valores negativos produzidos internamente por operações como `subtract()` e `negate()`, uma wallet não pode ser aberta com saldo negativo.

Essa validação garante que a `Wallet` já nasça respeitando a invariante de saldo não negativo.

A `version` começa em `1` na abertura e representa a versão atual do estado financeiro da wallet.

---

## Rehydration

Valida a reconstrução de uma `Wallet` a partir de um estado previamente persistido através de `Wallet.rehydrate()`.

Cenários:

- restaura `id` e `playerId`;
- restaura a moeda e o saldo persistidos;
- preserva a `version` existente;
- preserva `createdAt` e `updatedAt`.

`rehydrate()` não representa a criação de uma nova wallet.

Seu objetivo é reconstruir em memória uma wallet que já existia anteriormente, mantendo exatamente o estado recebido da camada de persistência.

Por esse motivo, valores como `version`, `createdAt` e `updatedAt` não são reinicializados durante a reidratação.

Essa separação permite que `Wallet.open()` concentre as regras de abertura enquanto `Wallet.rehydrate()` apenas restaura um estado já persistido.

---

## Credit

Valida a aplicação de créditos sobre o saldo da wallet.

Cenários:

- adiciona o valor creditado ao saldo atual;
- incrementa a `version` quando o saldo é alterado;
- atualiza `updatedAt` quando o saldo é alterado;
- não altera saldo, `version` ou `updatedAt` ao creditar zero;
- rejeita créditos em moeda diferente da moeda da wallet;
- rejeita valores negativos como entrada de `credit()`.

### Alteração de saldo e versionamento

Um crédito válido utiliza a operação de soma fornecida pelo value object `Money`.

A wallet não realiza aritmética monetária diretamente e não trabalha com `number` ou `Decimal`. Ela delega o cálculo para `Money` e controla apenas a alteração de seu próprio estado.

Quando um crédito altera o saldo:

- `_balance` recebe o novo valor;
- `_version` é incrementada;
- `_updatedAt` recebe o timestamp da alteração.

A `version` só é incrementada quando o saldo realmente muda.

Por esse motivo, um crédito de `0.00` não produz nenhuma alteração de estado.

### Créditos negativos

Embora `Money` possa representar valores negativos produzidos internamente por operações como `subtract()` e `negate()`, `Wallet.credit()` não aceita valores negativos como comando de movimentação.

O sentido financeiro da operação é definido pelo método utilizado, e não pelo sinal do `Money`.

Por exemplo:

- `credit(50.00 BRL)` representa um aumento de `50.00 BRL`;
- um valor negativo não pode ser utilizado para transformar `credit()` implicitamente em uma operação de débito.

Essa regra mantém a semântica das operações da wallet explícita e previsível.

### Currency Safety

Toda movimentação precisa utilizar a mesma moeda da wallet.

Uma wallet em `BRL`, por exemplo, não pode receber um crédito em `USD`.

Quando a moeda do `Money` recebido é diferente da moeda da wallet, a operação é rejeitada com `CurrencyMismatchError`.

Não existe conversão cambial dentro da wallet.

---

## Debit

Valida a aplicação de débitos sobre o saldo da wallet.

Cenários:

- subtrai o valor debitado do saldo atual;
- permite débito igual ao saldo disponível, resultando em saldo zero;
- rejeita débito maior que o saldo disponível;
- não altera o estado da wallet quando o débito é rejeitado;
- incrementa a `version` quando o saldo é alterado;
- atualiza `updatedAt` quando o saldo é alterado;
- não altera saldo, `version` ou `updatedAt` ao debitar zero;
- rejeita débitos em moeda diferente da moeda da wallet;
- rejeita valores negativos como entrada de `debit()`.

### Saldo não negativo

Uma das principais invariantes da `Wallet` é que seu saldo nunca pode ficar negativo.

Antes de aplicar um débito, a wallet verifica se o saldo atual é suficiente para cobrir o valor solicitado.

Quando o valor do débito é maior que o saldo disponível, a operação é rejeitada com `InsufficientBalanceError`.

Por exemplo:

```text
saldo atual: 100.00 BRL
débito:      150.00 BRL
```

A operação é rejeitada e o saldo permanece em `100.00 BRL`.

Já um débito igual ao saldo disponível é válido:

```text
saldo atual: 100.00 BRL
débito:      100.00 BRL
saldo final:   0.00 BRL
```

Saldo zero é permitido. Apenas valores negativos são proibidos.

### Falhas não alteram o estado

Quando um débito é rejeitado por saldo insuficiente, nenhum estado da wallet deve ser modificado.

Isso significa que permanecem inalterados:

- `balance`;
- `version`;
- `updatedAt`.

Essa garantia evita que uma operação inválida deixe a aggregate em um estado parcialmente atualizado.

### Alteração de saldo e versionamento

Assim como em `credit()`, um débito válido utiliza as operações fornecidas pelo value object `Money`.

A wallet não realiza cálculos monetários utilizando `number` ou manipula diretamente a representação decimal.

Quando o débito altera o saldo:

- `_balance` recebe o resultado da subtração;
- `_version` é incrementada;
- `_updatedAt` recebe o timestamp da alteração.

A `version` só muda quando o saldo realmente é alterado.

Por isso, um débito de `0.00` não modifica nenhuma dessas propriedades.

### Débitos negativos

Embora `Money` possa representar valores negativos produzidos internamente, `Wallet.debit()` recebe apenas magnitudes positivas ou zero.

Permitir um valor negativo produziria um comportamento contrário ao significado do método.

Por exemplo:

```text
100.00 - (-50.00) = 150.00
```

Nesse caso, um método chamado `debit()` estaria aumentando o saldo.

Por isso, valores negativos são rejeitados antes da movimentação.

O sentido financeiro permanece definido explicitamente pela operação utilizada:

- `credit()` aumenta o saldo;
- `debit()` diminui o saldo.

### Currency Safety

O valor debitado deve possuir a mesma moeda da wallet.

Uma wallet em `BRL` não pode sofrer um débito em `USD`.

Quando as moedas são diferentes, a operação é rejeitada com `CurrencyMismatchError`.

Não existe conversão automática de moeda dentro da `Wallet`.

---

## Resumo da cobertura

| Área                | O que é validado                                                   | Garantia principal                                                 |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **Opening**         | Estado inicial, saldo zero, versão e timestamps                    | A wallet nasce com estado consistente                              |
| **Rehydration**     | Restauração do estado persistido                                   | Estado existente não é reinicializado                              |
| **Credit**          | Crédito, versão, timestamp, zero e entradas inválidas              | Créditos alteram o saldo de forma explícita e segura               |
| **Debit**           | Débito, saldo insuficiente, versão, timestamp e entradas inválidas | Débitos nunca produzem saldo negativo                              |
| **Currency Safety** | Créditos e débitos em moedas diferentes                            | Movimentações não misturam moedas                                  |
| **Negative Values** | Rejeição de créditos e débitos negativos                           | O sentido da movimentação é definido pela operação, não pelo sinal |

A suíte atual cobre a abertura, reidratação e as operações de crédito e débito da `Wallet`, incluindo suas principais invariantes de saldo, moeda e versionamento.
