import { WagerTransaction } from '@/wagering/domain/wager-transaction.js';

export interface WagerTransactionRepository {
  insert(transaction: WagerTransaction): Promise<void>;

  findById(id: string): Promise<WagerTransaction | undefined>;

  findByProviderAndExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined>;

  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | undefined>;
}
