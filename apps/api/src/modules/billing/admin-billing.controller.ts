import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { UserRole } from '@repo/types/auth';
import {
  markPaidSchema,
  quotationInputSchema,
  transactionsQuerySchema,
  type BillingDocumentSummary,
  type FxQuote,
  type TransactionsPage,
  type TransactionsSummary,
} from '@repo/types/billing-documents';
import { BILLING_CURRENCIES } from '@repo/types/subscriptions';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { BillingDocumentsService } from './billing-documents.service';
import { FxService } from './fx.service';

class QuotationDto extends createZodDto(quotationInputSchema) {}
class MarkPaidDto extends createZodDto(markPaidSchema) {}
class TransactionsQueryDto extends createZodDto(transactionsQuerySchema) {}
class FxQueryDto extends createZodDto(
  z.object({ currency: z.enum(BILLING_CURRENCIES) }),
) {}

/**
 * Quotations, invoices and Transactions (docs/subscriptions_planing.md
 * §4d, B4–B8, B21). Super admin only.
 */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminBillingController {
  constructor(
    private readonly documents: BillingDocumentsService,
    private readonly fx: FxService,
  ) {}

  @Get('billing/fx')
  quote(@Query() query: FxQueryDto): Promise<FxQuote> {
    return this.fx.quote(query.currency);
  }

  @Get('companies/:id/documents')
  listForCompany(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillingDocumentSummary[]> {
    return this.documents.listForCompany(id);
  }

  @Post('companies/:id/quotations')
  createQuotation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuotationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BillingDocumentSummary> {
    return this.documents.createQuotation(id, dto, actor.id);
  }

  @Get('billing/transactions')
  transactions(
    @Query() query: TransactionsQueryDto,
  ): Promise<TransactionsPage> {
    return this.documents.transactions(query);
  }

  @Get('billing/transactions/summary')
  summary(): Promise<TransactionsSummary> {
    return this.documents.summary();
  }

  @Get('billing/transactions.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="transactions.csv"')
  csv(@Query() query: TransactionsQueryDto): Promise<string> {
    return this.documents.csv(query);
  }

  @Get('billing/documents/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<BillingDocumentSummary> {
    return this.documents.get(id);
  }

  @Patch('billing/documents/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuotationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BillingDocumentSummary> {
    return this.documents.updateQuotation(id, dto, actor.id);
  }

  @Post('billing/documents/:id/void')
  @HttpCode(200)
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BillingDocumentSummary> {
    return this.documents.voidQuotation(id, actor.id);
  }

  @Post('billing/documents/:id/pay')
  @HttpCode(200)
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPaidDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BillingDocumentSummary> {
    return this.documents.markPaid(id, dto, actor.id);
  }
}
