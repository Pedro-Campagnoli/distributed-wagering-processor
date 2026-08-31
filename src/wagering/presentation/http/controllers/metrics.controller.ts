import { Controller, Get } from '@nestjs/common';

import { OperationalMetrics } from '../../../infrastructure/observability/operational-metrics.js';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: OperationalMetrics) {}

  @Get()
  getMetrics() {
    return this.metrics.snapshot();
  }
}
