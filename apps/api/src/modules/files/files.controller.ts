import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import { UserRole } from '@repo/types/auth';
import { uploadFileSchema, type UploadedFileSummary } from '@repo/types/files';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { MAX_UPLOAD_BYTES } from './file-purposes';
import { FilesService } from './files.service';

class UploadFileDto extends createZodDto(uploadFileSchema) {}

/**
 * The one upload API (docs/company_profile_planing.md P8, §3b): upload a
 * file for a purpose, get back an id, hand that id to the API that uses
 * it (e.g. `PATCH /company/profile { logoFileId }`).
 *
 * Not `@TenantScoped()`: `files` is control-plane data, like
 * CompanyUsersController's `users`. The boundary is `companyId` from the
 * verified JWT (none for a super admin = the platform's files), applied
 * in every query, so another owner's id is a 404, never a 403.
 */
@Roles(UserRole.SUPER_ADMIN, UserRole.COMPANY_ADMIN, UserRole.USER)
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  // multer's cap is the largest any purpose takes, so an oversized upload
  // is cut off while streaming (413); the purpose's own, smaller limit is
  // checked in the service.
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadFileDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<UploadedFileSummary> {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.files.upload(
      { id: actor.id, role: actor.role, companyId: ownerOf(actor) },
      dto.purpose,
      file,
    );
  }

  // `no-store` like every response (NoStoreMiddleware): the web keeps the
  // logo in memory for the tab. `nosniff`: the browser trusts the checked type.
  @Get(':id')
  @Header('X-Content-Type-Options', 'nosniff')
  async read(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<StreamableFile> {
    const file = await this.files.read(ownerOf(actor), id);
    return new StreamableFile(file.body, {
      type: file.contentType,
      length: file.sizeBytes,
      disposition: 'inline',
    });
  }
}

/** A company user's company; a super admin's files are the platform's
 * (owner null). Which purposes each role may upload is FILE_PURPOSES'. */
function ownerOf(actor: AuthenticatedRequestUser): string | null {
  if (actor.role === UserRole.SUPER_ADMIN) return null;
  if (!actor.companyId) {
    throw new ForbiddenException('This route requires a company.');
  }
  return actor.companyId;
}
