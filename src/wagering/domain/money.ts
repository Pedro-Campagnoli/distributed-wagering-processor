import { Decimal } from 'decimal.js';
import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
} from './errors.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private static readonly AMOUNT_PATTERN = /^\d+\.\d{2}$/;

  private static readonly CURRENCY_PATTERN = /^[A-Z]{3}$/;

  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (!Money.AMOUNT_PATTERN.test(props.amount)) {
      throw new InvalidMoneyAmountError(props.amount);
    }

    if (!Money.CURRENCY_PATTERN.test(props.currency)) {
      throw new InvalidCurrencyError(props.currency);
    }

    const value = new Decimal(props.amount);

    if (!value.isFinite()) {
      throw new InvalidMoneyAmountError(props.amount);
    }

    return new Money(value, props.currency);
  }

  static zero(currency: string): Money {
    return Money.from({
      amount: '0.00',
      currency,
    });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);

    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);

    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);

    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
