import { describe, expect, it } from 'bun:test';

import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
} from './errors.js';

import { Money } from './money.js';

describe('Money', () => {
  describe('creation', () => {
    it('should create money from a valid amount and currency', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      expect(money.toJSON()).toEqual({
        amount: '25.00',
        currency: 'BRL',
      });
    });

    it('should create zero money', () => {
      const money = Money.zero('BRL');

      expect(money.toJSON()).toEqual({
        amount: '0.00',
        currency: 'BRL',
      });
    });

    it('should allow representing a negative value internally', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      const negative = money.negate();

      expect(negative.toJSON()).toEqual({
        amount: '-25.00',
        currency: 'BRL',
      });
    });
  });

  describe('validation', () => {
    describe('amount', () => {
      it.each([
        '',
        '25',
        '25.0',
        '10.000',
        '1e3',
        'NaN',
        'Infinity',
        '-25.00',
        'abc',
        '25.ab',
        '25.0a',
      ])('should reject invalid amount "%s"', (amount) => {
        expect(() =>
          Money.from({
            amount,
            currency: 'BRL',
          }),
        ).toThrow(InvalidMoneyAmountError);
      });

      it('should reject amounts instead of rounding more than two decimal places', () => {
        expect(() =>
          Money.from({
            amount: '25.001',
            currency: 'BRL',
          }),
        ).toThrow(InvalidMoneyAmountError);
      });
    });

    describe('currency', () => {
      it.each(['', 'BR', 'BRLL', 'brl', 'BrL'])(
        'should reject invalid currency "%s"',
        (currency) => {
          expect(() =>
            Money.from({
              amount: '25.00',
              currency,
            }),
          ).toThrow(InvalidCurrencyError);
        },
      );
    });
  });

  describe('arithmetic', () => {
    it('should add money with the same currency', () => {
      const first = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const second = Money.from({
        amount: '5.50',
        currency: 'BRL',
      });

      const result = first.add(second);

      expect(result.toJSON()).toEqual({
        amount: '15.50',
        currency: 'BRL',
      });
    });

    it('should subtract money with the same currency', () => {
      const first = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const second = Money.from({
        amount: '3.50',
        currency: 'BRL',
      });

      const result = first.subtract(second);

      expect(result.toJSON()).toEqual({
        amount: '6.50',
        currency: 'BRL',
      });
    });

    it('should allow subtraction to produce a negative value', () => {
      const first = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const second = Money.from({
        amount: '20.00',
        currency: 'BRL',
      });

      const result = first.subtract(second);

      expect(result.toJSON()).toEqual({
        amount: '-10.00',
        currency: 'BRL',
      });
    });

    it('should negate money', () => {
      const money = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const result = money.negate();

      expect(result.toJSON()).toEqual({
        amount: '-10.00',
        currency: 'BRL',
      });
    });

    it('should perform exact decimal arithmetic', () => {
      const first = Money.from({
        amount: '0.10',
        currency: 'BRL',
      });

      const second = Money.from({
        amount: '0.20',
        currency: 'BRL',
      });

      const result = first.add(second);

      expect(result.toJSON()).toEqual({
        amount: '0.30',
        currency: 'BRL',
      });
    });
  });

  describe('comparison', () => {
    it('should identify zero money', () => {
      const money = Money.zero('BRL');

      expect(money.isZero()).toBe(true);
      expect(money.isPositive()).toBe(false);
      expect(money.isNegative()).toBe(false);
    });

    it('should identify positive money', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      expect(money.isZero()).toBe(false);
      expect(money.isPositive()).toBe(true);
      expect(money.isNegative()).toBe(false);
    });

    it('should identify negative money produced internally', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      }).negate();

      expect(money.isZero()).toBe(false);
      expect(money.isPositive()).toBe(false);
      expect(money.isNegative()).toBe(true);
    });

    it('should identify when money is less than another value', () => {
      const smaller = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const greater = Money.from({
        amount: '20.00',
        currency: 'BRL',
      });

      expect(smaller.isLessThan(greater)).toBe(true);
      expect(greater.isLessThan(smaller)).toBe(false);
    });

    it('should identify equal money values', () => {
      const first = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      const second = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      expect(first.equals(second)).toBe(true);
    });

    it('should identify different money values', () => {
      const first = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      const second = Money.from({
        amount: '30.00',
        currency: 'BRL',
      });

      expect(first.equals(second)).toBe(false);
    });
  });

  describe('currency safety', () => {
    it('should reject addition between different currencies', () => {
      const brl = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const usd = Money.from({
        amount: '5.00',
        currency: 'USD',
      });

      expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    });

    it('should reject subtraction between different currencies', () => {
      const brl = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const usd = Money.from({
        amount: '5.00',
        currency: 'USD',
      });

      expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    });

    it('should reject comparison between different currencies', () => {
      const brl = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const usd = Money.from({
        amount: '5.00',
        currency: 'USD',
      });

      expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
    });

    it('should not consider values with different currencies equal', () => {
      const brl = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const usd = Money.from({
        amount: '10.00',
        currency: 'USD',
      });

      expect(brl.equals(usd)).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should serialize money to JSON', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      expect(money.toJSON()).toEqual({
        amount: '25.00',
        currency: 'BRL',
      });
    });

    it('should serialize amount as a string with two decimal places', () => {
      const money = Money.from({
        amount: '10.00',
        currency: 'BRL',
      }).subtract(
        Money.from({
          amount: '5.50',
          currency: 'BRL',
        }),
      );

      const result = money.toJSON();

      expect(result.amount).toBe('4.50');
      expect(typeof result.amount).toBe('string');
    });

    it('should serialize money to string', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      expect(money.toString()).toBe('25.00 BRL');
    });
  });

  describe('immutability', () => {
    it('should not mutate the original money when adding', () => {
      const original = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const other = Money.from({
        amount: '5.00',
        currency: 'BRL',
      });

      const result = original.add(other);

      expect(original.toJSON()).toEqual({
        amount: '10.00',
        currency: 'BRL',
      });

      expect(result.toJSON()).toEqual({
        amount: '15.00',
        currency: 'BRL',
      });

      expect(result).not.toBe(original);
    });

    it('should not mutate the original money when subtracting', () => {
      const original = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const other = Money.from({
        amount: '4.00',
        currency: 'BRL',
      });

      const result = original.subtract(other);

      expect(original.toJSON()).toEqual({
        amount: '10.00',
        currency: 'BRL',
      });

      expect(result.toJSON()).toEqual({
        amount: '6.00',
        currency: 'BRL',
      });

      expect(result).not.toBe(original);
    });

    it('should not mutate the original money when negating', () => {
      const original = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const result = original.negate();

      expect(original.toJSON()).toEqual({
        amount: '10.00',
        currency: 'BRL',
      });

      expect(result.toJSON()).toEqual({
        amount: '-10.00',
        currency: 'BRL',
      });

      expect(result).not.toBe(original);
    });
  });
});
