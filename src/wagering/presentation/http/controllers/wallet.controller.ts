import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Money } from '../../../domain/money.js';
import { OpenWalletUseCase } from '../../../application/use-cases/open-wallet.use-case.js';
import { WageringQueryService } from '../../../application/services/wagering-query.service.js';
import { CreateWalletDto } from '../dto/create-wallet.dto.js';
import { LedgerQueryDto } from '../dto/ledger-query.dto.js';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly openWalletUseCase: OpenWalletUseCase,
    private readonly queries: WageringQueryService,
  ) {}

  @Post()
  async create(@Body() dto: CreateWalletDto) {
    const wallet = await this.openWalletUseCase.execute({
      playerId: dto.playerId,
      initialBalance: Money.from(dto.initialBalance),
    });

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
    @Query() query: LedgerQueryDto,
  ) {
    const page = await this.queries.getWalletLedger(
      walletId,
      query.cursor,
      query.limit,
    );

    return {
      entries: page.entries.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Post(':walletId/reconciliation')
  async reconcile(@Param('walletId', new ParseUUIDPipe()) walletId: string) {
    const reconciliation = await this.queries.reconcileWallet(walletId);

    return {
      walletId: reconciliation.walletId,
      storedBalance: reconciliation.storedBalance.toJSON(),
      calculatedBalance: reconciliation.calculatedBalance.toJSON(),
      difference: reconciliation.difference.toJSON(),
      consistent: reconciliation.consistent,
      checkedEntries: reconciliation.checkedEntries,
    };
  }

  @Get(':walletId')
  async findOne(@Param('walletId', new ParseUUIDPipe()) walletId: string) {
    const wallet = await this.queries.getWallet(walletId);

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }
}
