import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoredFile } from '../../database/control-plane/entities/stored-file.entity';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

// The one upload API (docs/company_profile_planing.md §3b). Exports
// FilesService so the APIs that use a file (company profile, reports)
// attach, read and release it through the same checks.
@Module({
  imports: [TypeOrmModule.forFeature([StoredFile])],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
