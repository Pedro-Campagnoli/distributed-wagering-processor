import { randomUUID } from 'node:crypto';

import type { MikroORM } from '@mikro-orm/postgresql';
import { expect } from 'bun:test';
import { Decimal } from 'decimal.js';

import { OpenWalletUseCase } from '../../src/wagering/application/use-cases/open-wallet.use-case.js';
import { Money } from '../../src/wagering/domain/money.js';
import { LedgerDirection } from '../../src/wagering/domain/wallet-ledger-entry.js';

interface PersistedWalletBalance {
  balance: string;
}

interface PersistedLedgerAmount {
  amount: string;
  direction: LedgerDirection;
}

export async function openWalletFixture(
  orm: MikroORM,
  walletId: string,
  playerId: string,
  initialBalance = '100.00',
): Promise<void> {
  const ids = [walletId, randomUUID(), randomUUID()];
  let index = 0;

  await new OpenWalletUseCase(orm.em.fork(), () => {
    const id = ids[index++];

    if (!id) {
      throw new Error('No financial fixture id available');
    }

    return id;
  }).execute({
    playerId,
    initialBalance: Money.from({
      amount: initialBalance,
      currency: 'BRL',
    }),
  });
}

export function expectWalletBalanceMatchesLedger(
  wallet: PersistedWalletBalance | null,
  ledgerEntries: PersistedLedgerAmount[],
): void {
  if (!wallet) {
    throw new Error('Expected wallet fixture to exist');
  }

  const reconstructedBalance = ledgerEntries.reduce(
    (balance, entry) =>
      entry.direction === LedgerDirection.Credit
        ? balance.plus(entry.amount)
        : balance.minus(entry.amount),
    new Decimal(0),
  );

  expect(reconstructedBalance.toFixed(2)).toBe(wallet.balance);
}
