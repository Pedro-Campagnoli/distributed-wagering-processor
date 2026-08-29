import { describe, expect, it } from 'bun:test';

import { Money } from './money.js';
import { LedgerDirection, WalletLedgerEntry } from './wallet-ledger-entry.js';
import {
  InvalidLedgerAmountError,
  UnbalancedLedgerEntryError,
} from './errors.js';

describe('WalletLedgerEntry', () => {
  describe('creation', () => {
    it('should create a balanced credit ledger entry', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      const balanceBefore = Money.from({
        amount: '100.00',
        currency: 'BRL',
      });

      const balanceAfter = Money.from({
        amount: '125.00',
        currency: 'BRL',
      });

      const entry = WalletLedgerEntry.create({
        id: 'ledger-entry-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: LedgerDirection.Credit,
        money,
        balanceBefore,
        balanceAfter,
      });

      expect(entry.id).toBe('ledger-entry-1');
      expect(entry.walletId).toBe('wallet-1');
      expect(entry.transactionId).toBe('transaction-1');
      expect(entry.direction).toBe(LedgerDirection.Credit);

      expect(entry.money.equals(money)).toBe(true);
      expect(entry.balanceBefore.equals(balanceBefore)).toBe(true);
      expect(entry.balanceAfter.equals(balanceAfter)).toBe(true);

      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.isBalanced()).toBe(true);
    });

    it('should create a balanced debit ledger entry', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      const balanceBefore = Money.from({
        amount: '100.00',
        currency: 'BRL',
      });

      const balanceAfter = Money.from({
        amount: '75.00',
        currency: 'BRL',
      });

      const entry = WalletLedgerEntry.create({
        id: 'ledger-entry-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: LedgerDirection.Debit,
        money,
        balanceBefore,
        balanceAfter,
      });

      expect(entry.id).toBe('ledger-entry-1');
      expect(entry.walletId).toBe('wallet-1');
      expect(entry.transactionId).toBe('transaction-1');
      expect(entry.direction).toBe(LedgerDirection.Debit);

      expect(entry.money.equals(money)).toBe(true);
      expect(entry.balanceBefore.equals(balanceBefore)).toBe(true);
      expect(entry.balanceAfter.equals(balanceAfter)).toBe(true);

      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.isBalanced()).toBe(true);
    });

    it('should reject an unbalanced credit ledger entry', () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: 'ledger-entry-1',
          walletId: 'wallet-1',
          transactionId: 'transaction-1',
          direction: LedgerDirection.Credit,
          money: Money.from({
            amount: '25.00',
            currency: 'BRL',
          }),
          balanceBefore: Money.from({
            amount: '100.00',
            currency: 'BRL',
          }),
          balanceAfter: Money.from({
            amount: '120.00',
            currency: 'BRL',
          }),
        }),
      ).toThrow(UnbalancedLedgerEntryError);
    });

    it('should reject an unbalanced debit ledger entry', () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: 'ledger-entry-1',
          walletId: 'wallet-1',
          transactionId: 'transaction-1',
          direction: LedgerDirection.Debit,
          money: Money.from({
            amount: '25.00',
            currency: 'BRL',
          }),
          balanceBefore: Money.from({
            amount: '100.00',
            currency: 'BRL',
          }),
          balanceAfter: Money.from({
            amount: '80.00',
            currency: 'BRL',
          }),
        }),
      ).toThrow(UnbalancedLedgerEntryError);
    });

    it('should reject a negative ledger amount', () => {
      const negative = Money.from({
        amount: '25.00',
        currency: 'BRL',
      }).negate();

      expect(() =>
        WalletLedgerEntry.create({
          id: 'ledger-entry-1',
          walletId: 'wallet-1',
          transactionId: 'transaction-1',
          direction: LedgerDirection.Credit,
          money: negative,
          balanceBefore: Money.from({
            amount: '100.00',
            currency: 'BRL',
          }),
          balanceAfter: Money.from({
            amount: '75.00',
            currency: 'BRL',
          }),
        }),
      ).toThrow(InvalidLedgerAmountError);
    });

    it('should reject a zero ledger amount', () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: 'ledger-entry-1',
          walletId: 'wallet-1',
          transactionId: 'transaction-1',
          direction: LedgerDirection.Credit,
          money: Money.zero('BRL'),
          balanceBefore: Money.from({
            amount: '100.00',
            currency: 'BRL',
          }),
          balanceAfter: Money.from({
            amount: '100.00',
            currency: 'BRL',
          }),
        }),
      ).toThrow(InvalidLedgerAmountError);
    });
  });

  describe('rehydration', () => {
    it('should restore a ledger entry from persisted state', () => {
      const createdAt = new Date('2020-01-01T00:00:00.000Z');

      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      const balanceBefore = Money.from({
        amount: '100.00',
        currency: 'BRL',
      });

      const balanceAfter = Money.from({
        amount: '75.00',
        currency: 'BRL',
      });

      const entry = WalletLedgerEntry.rehydrate({
        id: 'ledger-entry-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: LedgerDirection.Debit,
        money,
        balanceBefore,
        balanceAfter,
        createdAt,
      });

      expect(entry.id).toBe('ledger-entry-1');
      expect(entry.walletId).toBe('wallet-1');
      expect(entry.transactionId).toBe('transaction-1');
      expect(entry.direction).toBe(LedgerDirection.Debit);

      expect(entry.money.equals(money)).toBe(true);
      expect(entry.balanceBefore.equals(balanceBefore)).toBe(true);
      expect(entry.balanceAfter.equals(balanceAfter)).toBe(true);

      expect(entry.createdAt).toEqual(createdAt);
    });
  });
});
