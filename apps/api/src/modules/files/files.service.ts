import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, LessThan, Repository } from 'typeorm';
import type { UserRole } from '@repo/types/auth';
import type { FilePurpose, UploadedFileSummary } from '@repo/types/files';
import { StoredFile } from '../../database/control-plane/entities/stored-file.entity';
import {
  companyStoragePrefix,
  FILE_STORAGE,
  ownerStoragePrefix,
  type FileStorage,
} from '../../storage/file-storage';
import { extensionFor, FILE_PURPOSES, sniffContentType } from './file-purposes';

/** An upload nothing attached within this long is deleted (§3b). */
export const PENDING_FILE_TTL_MS = 24 * 60 * 60 * 1000;

export interface UploadActor {
  id: string;
  role: UserRole;
  /** Null = a super admin: the file is the platform's own. */
  companyId: string | null;
}

/** Who owns a file: a company id, or null for the platform. */
export type FileOwner = string | null;

/** The owner in a where clause: `company_id = x` or `company_id IS NULL`. */
const ownerIs = (owner: FileOwner) => owner ?? IsNull();

/**
 * Files a company owns (docs/company_profile_planing.md §3b), or the
 * platform (owner null: the billing logo, subscriptions step 5). Every
 * lookup is by id AND owner: an id from another company is simply not
 * found (404), so ids can't be probed. The bytes go through FileStorage;
 * the row says what they are.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(StoredFile)
    private readonly files: Repository<StoredFile>,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async upload(
    actor: UploadActor,
    purpose: FilePurpose,
    file: { buffer: Buffer; originalname?: string },
  ): Promise<UploadedFileSummary> {
    const rule = FILE_PURPOSES[purpose];
    if (!rule.roles.includes(actor.role)) {
      throw new ForbiddenException('You cannot upload this kind of file.');
    }
    if (file.buffer.length > rule.maxBytes) {
      throw new PayloadTooLargeException(
        `File is larger than ${rule.maxBytes} bytes.`,
      );
    }
    const contentType = sniffContentType(file.buffer);
    if (!contentType || !rule.contentTypes.includes(contentType)) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: ${rule.contentTypes.join(', ')}.`,
      );
    }

    await this.sweepPending(actor.companyId);

    const id = randomUUID();
    const storageKey = `${ownerStoragePrefix(actor.companyId)}${purpose}/${id}.${extensionFor(contentType)}`;
    await this.storage.put(storageKey, file.buffer, contentType);
    try {
      await this.files.insert({
        id,
        companyId: actor.companyId,
        purpose,
        storageKey,
        contentType,
        sizeBytes: file.buffer.length,
        originalName: file.originalname?.slice(0, 255) || null,
        uploadedByUserId: actor.id,
        attachedAt: null,
      });
    } catch (error) {
      await this.deleteBlobQuietly(storageKey);
      throw error;
    }
    return { id, purpose, contentType, sizeBytes: file.buffer.length };
  }

  /** The file's bytes for a user of the owner. */
  async read(
    owner: FileOwner,
    id: string,
  ): Promise<{ body: Buffer; contentType: string; sizeBytes: number }> {
    const row = await this.files.findOne({
      where: { id, companyId: ownerIs(owner) },
    });
    const body = row ? await this.storage.get(row.storageKey) : null;
    if (!row || !body) throw new NotFoundException('File not found.');
    return { body, contentType: row.contentType, sizeBytes: row.sizeBytes };
  }

  /**
   * Marks a pending upload as used, so the sweep leaves it alone. Refuses
   * an id that is missing, another company's, another purpose's, or
   * already attached — the check that makes a client-sent id safe to
   * store.
   */
  async attach(
    owner: FileOwner,
    id: string,
    purpose: FilePurpose,
  ): Promise<void> {
    const result = await this.files.update(
      { id, companyId: ownerIs(owner), purpose, attachedAt: IsNull() },
      { attachedAt: new Date() },
    );
    if (!result.affected) {
      throw new BadRequestException('That file cannot be used here.');
    }
  }

  /** Undoes `attach` (the write that used the file failed). */
  async detach(owner: FileOwner, id: string): Promise<void> {
    await this.files.update(
      { id, companyId: ownerIs(owner) },
      { attachedAt: null },
    );
  }

  /** Deletes a file that is no longer used (a replaced or removed logo).
   * Best-effort on the bytes: a leftover blob is harmless. */
  async release(owner: FileOwner, id: string): Promise<void> {
    const row = await this.files.findOne({
      where: { id, companyId: ownerIs(owner) },
    });
    if (!row) return;
    await this.files.delete({ id: row.id });
    await this.deleteBlobQuietly(row.storageKey);
  }

  /** Deletes this company's uploads that nothing attached within the
   * TTL. Run on each upload rather than on a timer: a company that never
   * uploads again has at most one stale file. */
  async sweepPending(owner: FileOwner, now = new Date()): Promise<number> {
    const stale = await this.files.find({
      where: {
        companyId: ownerIs(owner),
        attachedAt: IsNull(),
        createdAt: LessThan(new Date(now.getTime() - PENDING_FILE_TTL_MS)),
      },
      select: { id: true, storageKey: true },
    });
    for (const row of stale) {
      await this.files.delete({ id: row.id });
      await this.deleteBlobQuietly(row.storageKey);
    }
    return stale.length;
  }

  /** After a company is permanently deleted: its rows cascaded with it,
   * this clears the bytes. */
  async deleteCompanyFiles(companyId: string): Promise<void> {
    try {
      const count = await this.storage.deletePrefix(
        companyStoragePrefix(companyId),
      );
      if (count)
        this.logger.log(`Deleted ${count} files of company ${companyId}`);
    } catch (error) {
      this.logger.error(
        `Could not delete the files of company ${companyId}: ${(error as Error).message}`,
      );
    }
  }

  private async deleteBlobQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        `Could not delete blob ${key}: ${(error as Error).message}`,
      );
    }
  }
}
