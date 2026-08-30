import { Body, Controller, Post } from '@nestjs/common';
import { Money } from '../../../domain/money.js';
import { OpenWalletUseCase } from '../../../application/use-cases/open-wallet.use-case.js';
import { CreateWalletDto } from '../dto/create-wallet.dto.js';

@Controller('wallets')
export class WalletController {
  constructor(private readonly openWalletUseCase: OpenWalletUseCase) {}

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
}
