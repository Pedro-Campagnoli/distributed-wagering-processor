import {
  CurrencyMismatchError,
  InsufficientBalanceError,
  InvalidMoneyAmountError,
} from './errors.js';
import { Money } from './money.js';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new InvalidMoneyAmountError(props.initialBalance.toString());
    }
    const now = new Date();

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  credit(money: Money): void {
    this.assertSameCurrency(money);
    this.assertNonNegative(money);

    if (money.isZero()) {
      return;
    }

    this._balance = this._balance.add(money);
    this._version++;
    this._updatedAt = new Date();
  }

  debit(money: Money): void {
    this.assertSameCurrency(money);
    this.assertNonNegative(money);

    if (money.isZero()) {
      return;
    }

    if (this._balance.isLessThan(money)) {
      throw new InsufficientBalanceError();
    }

    this._balance = this._balance.subtract(money);
    this._version++;
    this._updatedAt = new Date();
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }

  private assertNonNegative(money: Money): void {
    if (money.isNegative()) {
      throw new InvalidMoneyAmountError(money.toString());
    }
  }
}
