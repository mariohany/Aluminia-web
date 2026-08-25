import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { WindowsController } from './windows.controller';
import { WindowsService } from './windows.service';

// No TypeOrmModule.forFeature — same reason as ProjectsModule: a tenant
// repository binds to one schema at construction time, which is exactly
// what must not happen here.
@Module({
  imports: [TenancyModule],
  controllers: [WindowsController],
  providers: [WindowsService],
  exports: [WindowsService],
})
export class WindowsModule {}
