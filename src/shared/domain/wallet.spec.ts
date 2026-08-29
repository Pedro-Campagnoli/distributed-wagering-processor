import { describe, expect, it } from 'bun:test';

import { Money } from './money.js';
import { Wallet } from './wallet.js';
import {
  CurrencyMismatchError,
  InsufficientBalanceError,
  InvalidMoneyAmountError,
} from './errors.js';

describe('Wallet', () => {
  describe('opening', () => {
    it('should open a wallet with the initial balance', () => {
      const initialBalance = Money.from({
        amount: '100.00',
        currency: 'BRL',
      });

      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance,
      });

      expect(wallet.id).toBe('wallet-1');
      expect(wallet.playerId).toBe('player-1');
      expect(wallet.currency).toBe('BRL');
      expect(wallet.balance.equals(initialBalance)).toBe(true);
      expect(wallet.version).toBe(1);
    });

    it('should open a wallet with zero balance', () => {
      const initialBalance = Money.zero('BRL');

      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance,
      });

      expect(wallet.balance.isZero()).toBe(true);
      expect(wallet.version).toBe(1);
    });

    it('should initialize createdAt and updatedAt with the same timestamp', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.zero('BRL'),
      });

      expect(wallet.createdAt).toBeInstanceOf(Date);
      expect(wallet.updatedAt).toEqual(wallet.createdAt);
    });

    it('should reject negative initial balance', () => {
      const negative = Money.from({
        amount: '100.00',
        currency: 'BRL',
      }).negate();

      expect(() =>
        Wallet.open({
          id: 'wallet-1',
          playerId: 'player-1',
          initialBalance: negative,
        }),
      ).toThrow(InvalidMoneyAmountError);
    });
  });

  describe('rehydration', () => {
    it('should restore a wallet from persisted state', () => {
      const createdAt = new Date('2020-01-01T00:00:00.000Z');
      const updatedAt = new Date('2020-01-01T00:00:00.000Z');
      const balance = Money.from({
        amount: '75.00',
        currency: 'BRL',
      });

      const wallet = Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance,
        version: 3,
        createdAt,
        updatedAt,
      });

      expect(wallet.id).toBe('wallet-1');
      expect(wallet.playerId).toBe('player-1');
      expect(wallet.currency).toBe('BRL');
      expect(wallet.balance.equals(balance)).toBe(true);
      expect(wallet.version).toBe(3);
      expect(wallet.createdAt).toEqual(createdAt);
      expect(wallet.updatedAt).toEqual(updatedAt);
    });
  });

  describe('credit', () => {
    it('should credit money to the wallet', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
      });

      wallet.credit(
        Money.from({
          amount: '50.00',
          currency: 'BRL',
        }),
      );

      expect(
        wallet.balance.equals(
          Money.from({
            amount: '150.00',
            currency: 'BRL',
          }),
        ),
      ).toBe(true);

      expect(wallet.version).toBe(2);
    });

    it('should update updatedAt when balance changes', () => {
      const updatedAt = new Date('2020-01-01T00:00:00.000Z');

      const wallet = Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        version: 1,
        createdAt: updatedAt,
        updatedAt,
      });

      wallet.credit(
        Money.from({
          amount: '50.00',
          currency: 'BRL',
        }),
      );

      expect(wallet.updatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
    });

    it('should not change wallet state when crediting zero', () => {
      const updatedAt = new Date('2020-01-01T00:00:00.000Z');

      const wallet = Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        version: 3,
        createdAt: updatedAt,
        updatedAt,
      });

      wallet.credit(Money.zero('BRL'));

      expect(wallet.balance.toString()).toBe('100.00 BRL');
      expect(wallet.version).toBe(3);
      expect(wallet.updatedAt).toEqual(updatedAt);
    });

    it('should reject credit with a different currency', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.zero('BRL'),
      });

      const money = Money.from({
        amount: '50.00',
        currency: 'USD',
      });

      expect(() => wallet.credit(money)).toThrow(CurrencyMismatchError);
    });

    it('should reject negative credit', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
      });

      const negative = Money.from({
        amount: '50.00',
        currency: 'BRL',
      }).negate();

      expect(() => wallet.credit(negative)).toThrow(InvalidMoneyAmountError);
    });
  });

  describe('debit', () => {
    it('should debit money from the wallet', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
      });

      wallet.debit(
        Money.from({
          amount: '40.00',
          currency: 'BRL',
        }),
      );

      expect(
        wallet.balance.equals(
          Money.from({
            amount: '60.00',
            currency: 'BRL',
          }),
        ),
      ).toBe(true);

      expect(wallet.version).toBe(2);
    });

    it('should allow debit equal to the current balance', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
      });

      wallet.debit(
        Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
      );

      expect(wallet.balance.isZero()).toBe(true);
      expect(wallet.version).toBe(2);
    });

    it('should reject debit greater than the current balance', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
      });

      expect(() =>
        wallet.debit(
          Money.from({
            amount: '150.00',
            currency: 'BRL',
          }),
        ),
      ).toThrow(InsufficientBalanceError);
    });

    it('should not change wallet state when debit fails', () => {
      const updatedAt = new Date('2020-01-01T00:00:00.000Z');

      const wallet = Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        version: 3,
        createdAt: updatedAt,
        updatedAt,
      });

      expect(() =>
        wallet.debit(
          Money.from({
            amount: '150.00',
            currency: 'BRL',
          }),
        ),
      ).toThrow(InsufficientBalanceError);

      expect(wallet.balance.toString()).toBe('100.00 BRL');
      expect(wallet.version).toBe(3);
      expect(wallet.updatedAt).toEqual(updatedAt);
    });

    it('should not change wallet state when debiting zero', () => {
      const updatedAt = new Date('2020-01-01T00:00:00.000Z');

      const wallet = Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        version: 3,
        createdAt: updatedAt,
        updatedAt,
      });

      wallet.debit(Money.zero('BRL'));

      expect(wallet.balance.toString()).toBe('100.00 BRL');
      expect(wallet.version).toBe(3);
      expect(wallet.updatedAt).toEqual(updatedAt);
    });

    it('should reject debit with a different currency', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
      });

      expect(() =>
        wallet.debit(
          Money.from({
            amount: '50.00',
            currency: 'USD',
          }),
        ),
      ).toThrow(CurrencyMismatchError);
    });

    it('should reject negative debit', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
      });

      const negative = Money.from({
        amount: '50.00',
        currency: 'BRL',
      }).negate();

      expect(() => wallet.debit(negative)).toThrow(InvalidMoneyAmountError);
    });

    it('should update updatedAt when balance changes', () => {
      const updatedAt = new Date('2020-01-01T00:00:00.000Z');

      const wallet = Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        version: 1,
        createdAt: updatedAt,
        updatedAt,
      });

      wallet.debit(
        Money.from({
          amount: '20.00',
          currency: 'BRL',
        }),
      );

      expect(wallet.updatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
    });
  });
});
