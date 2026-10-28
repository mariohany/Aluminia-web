import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type { BillingDocumentSummary } from '@repo/types/billing-documents';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { BillingDocumentsService } from './billing-documents.service';

/**
 * Config › Subscription (docs/subscriptions_planing.md B24): the company's
 * own quotations and invoices, for its admins. Drafts and voided ones are
 * the super admin's working copies and never shown here.
 */
@Roles(UserRole.COMPANY_ADMIN)
@Controller('company/billing')
export class CompanyBillingController {
  constructor(private readonly documents: BillingDocumentsService) {}

  @Get('documents')
  async list(
    @CurrentUser() user: AuthenticatedRequestUser,
  ): Promise<BillingDocumentSummary[]> {
    if (!user.companyId) {
      throw new ForbiddenException('This route requires a company.');
    }
    const all = await this.documents.listForCompany(user.companyId);
    return all.filter((d) => d.status !== 'draft' && d.status !== 'void');
  }
}
