# Money

Este documento descreve os cenários de teste e as principais decisões de domínio relacionadas ao value object `Money`.

## Creation

Valida a criação e representação básica do value object `Money`.

Cenários:

- cria um `Money` válido a partir de `amount` e `currency`;
- cria um valor zero através de `Money.zero()`;
- permite representar valores negativos produzidos internamente por operações como `negate()`.

Esses testes garantem que o `Money` mantém sua representação monetária com escala fixa de duas casas e sem utilização de `number` para valores financeiros.

---

## Validation

Valida que `Money` aceita apenas representações monetárias compatíveis com o formato definido pelo domínio.

Cenários:

- rejeita string vazia;
- rejeita valores sem duas casas decimais;
- rejeita valores com mais de duas casas decimais;
- rejeita notação científica;
- rejeita `NaN` e `Infinity`;
- rejeita valores negativos na criação através de `Money.from()`;
- rejeita valores contendo caracteres não numéricos;
- rejeita moedas fora do formato de três letras maiúsculas.

### Uso de `it.each`

Os casos de validação utilizam `it.each` quando vários cenários possuem a mesma estrutura de teste e diferem apenas pelo valor de entrada.

Isso evita duplicação de código, mantém a suíte mais legível e facilita adicionar novos casos inválidos sem repetir a mesma preparação e expectativa.

Os valores utilizados representam diferentes categorias de entrada inválida, como strings vazias, escala incorreta, notação científica, valores especiais, valores negativos e caracteres não numéricos.

Não é necessário testar todas as combinações possíveis de strings inválidas. A suíte utiliza casos representativos de cada categoria para validar que qualquer entrada fora do formato esperado resulte em `InvalidMoneyAmountError`.

Casos que representam uma decisão específica do domínio podem possuir testes próprios, mesmo quando resultam no mesmo erro. Isso permite que a intenção do teste permaneça explícita na suíte.

### Escala e arredondamento

Valores monetários recebidos por `Money.from()` devem possuir exatamente duas casas decimais.

Entradas com mais de duas casas decimais não são arredondadas automaticamente. Em vez disso, são rejeitadas com `InvalidMoneyAmountError`.

Por exemplo, o valor `25.001` não é convertido silenciosamente para `25.00` ou `25.01`.

Essa decisão mantém o contrato de entrada previsível e evita alterações silenciosas em valores financeiros fornecidos ao sistema.

O comportamento possui um teste específico para tornar explícita a decisão de rejeitar o valor em vez de aplicar arredondamento.

### Valores negativos

Valores negativos não são aceitos na criação através de `Money.from()`.

Essa decisão garante que valores monetários recebidos pelos contratos de entrada sejam representados como magnitudes positivas ou zero. O efeito financeiro da operação não é representado pelo sinal do `Money`, mas pela regra de negócio responsável por processá-lo.

Por exemplo, uma `BET` recebe `Money` com valor `25.00`, e a regra da operação determina que esse valor deve ser debitado da wallet. Da mesma forma, uma `WIN` recebe um valor positivo e determina um crédito.

Apesar disso, `Money` pode assumir valores negativos como resultado de operações internas do domínio, como `subtract()` e `negate()`.

Esses métodos utilizam o construtor privado internamente e, portanto, não representam uma entrada externa no sistema.

Dessa forma, a criação pública de `Money` protege os contratos de entrada, enquanto as operações internas continuam capazes de representar resultados matemáticos negativos quando necessário.

---

## Arithmetic

Valida as operações aritméticas disponíveis no value object `Money`.

Cenários:

- soma valores da mesma moeda;
- subtrai valores da mesma moeda;
- permite que uma subtração produza um resultado negativo;
- inverte o sinal de um valor através de `negate()`;
- mantém precisão decimal exata em operações monetárias.

O teste de precisão utiliza valores como `0.10 + 0.20` e espera exatamente `0.30`.

Esse cenário é importante porque valores financeiros não utilizam `number` no domínio. As operações são realizadas com representação decimal exata, evitando problemas de precisão de ponto flutuante comuns no JavaScript.

Os testes deste bloco verificam apenas o resultado das operações. A garantia de imutabilidade dos valores originais é validada separadamente no bloco de testes de imutabilidade.

---

## Comparison

Valida os métodos de consulta e comparação do value object `Money`.

Cenários:

- identifica corretamente valores iguais a zero;
- identifica valores positivos;
- identifica valores negativos produzidos internamente;
- verifica quando um valor é menor que outro;
- identifica valores monetários equivalentes;
- identifica valores monetários diferentes.

Os testes deste bloco verificam apenas comparações entre valores da mesma moeda.

Embora o desafio permita assumir `BRL` como única moeda operacional, o modelo deve continuar multi-moeda.

Por isso, conflitos entre moedas diferentes são testados separadamente no bloco de segurança de moeda, mantendo cada grupo de testes focado em uma responsabilidade específica.

---

## Currency Safety

Valida que operações monetárias não sejam realizadas entre moedas diferentes.

Embora o desafio permita assumir `BRL` como única moeda operacional, o modelo de `Money` permanece multi-moeda e deve impedir operações inválidas entre moedas distintas.

Cenários:

- rejeita soma entre moedas diferentes;
- rejeita subtração entre moedas diferentes;
- rejeita comparação de magnitude entre moedas diferentes;
- considera valores com moedas diferentes como não equivalentes.

Operações como `add()`, `subtract()` e `isLessThan()` exigem que os dois valores possuam a mesma moeda. Quando isso não acontece, é lançado `CurrencyMismatchError`.

Já `equals()` não lança erro para moedas diferentes. Nesse caso, a comparação retorna `false`, pois valores com moedas distintas não representam o mesmo valor monetário.

Não há conversão cambial neste escopo. O domínio não tenta transformar valores entre moedas nem consultar taxas de câmbio. Moedas diferentes são tratadas apenas como incompatíveis para operações que exigem equivalência monetária.

---

## Serialization

Valida que `Money` seja serializado de forma estável e compatível com os contratos definidos pelo domínio.

Cenários:

- serializa o valor para o formato `{ amount, currency }`;
- mantém `amount` como `string`;
- mantém escala fixa de duas casas decimais;
- serializa corretamente valores produzidos por operações internas;
- fornece uma representação textual estável através de `toString()`.

A serialização não expõe a instância de `Decimal` utilizada internamente.

Em vez disso, `Money` é convertido para `MoneyProps`, mantendo o valor monetário como string decimal.

Isso garante que valores financeiros não sejam convertidos para `number` durante a saída do domínio e preserva a representação exata exigida pelos contratos da aplicação.

O método `toString()` fornece uma representação legível, como `25.00 BRL`, enquanto `toJSON()` é utilizado para obter a estrutura adequada para contratos e persistência.

---

## Immutability

Valida que `Money` seja imutável e que suas operações retornem novas instâncias em vez de alterar o estado existente.

Cenários:

- `add()` não altera a instância original;
- `subtract()` não altera a instância original;
- `negate()` não altera a instância original;
- cada operação retorna uma nova instância de `Money`.

A imutabilidade evita efeitos colaterais inesperados durante operações financeiras.

Quando uma operação é executada sobre um `Money`, o valor original permanece exatamente como estava e o resultado é representado por uma nova instância.

Por exemplo, ao somar `5.00 BRL` a um `Money` de `10.00 BRL`, a instância original continua representando `10.00 BRL`, enquanto o resultado representa `15.00 BRL`.

Além de verificar os valores antes e depois das operações, os testes também confirmam que o objeto retornado não é a mesma referência da instância original.

Essa abordagem mantém o comportamento do value object previsível e reduz o risco de alterações acidentais em valores monetários compartilhados por diferentes partes do domínio.

---

## Resumo da cobertura

| Área                | O que é validado                                   | Garantia principal                                             |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| **Creation**        | Criação, zero e representação interna de negativos | `Money` nasce em um estado válido                              |
| **Validation**      | Formato, escala, entradas inválidas e moeda        | Valores inválidos não entram no domínio                        |
| **Arithmetic**      | Soma, subtração, negação e precisão decimal        | Operações financeiras permanecem exatas                        |
| **Comparison**      | Zero, sinal, igualdade e ordenação                 | Consultas sobre valores são previsíveis                        |
| **Currency Safety** | Operações entre moedas diferentes                  | Não há mistura ou conversão implícita de moedas                |
| **Serialization**   | `MoneyProps`, strings e escala fixa                | Valores mantêm representação estável nas fronteiras do domínio |
| **Immutability**    | Preservação das instâncias originais               | Operações não produzem efeitos colaterais                      |

Em conjunto, a suíte cobre as operações públicas do value object `Money`, suas principais invariantes e os cenários de validação exigidos para o processamento seguro de valores financeiros.
