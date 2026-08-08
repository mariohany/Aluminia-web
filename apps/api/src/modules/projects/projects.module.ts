import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

// No TypeOrmModule.forFeature — same reason as ClientsModule: a tenant
// repository binds to one schema at construction time, which is exactly
// what must not happen here.
@Module({
  imports: [TenancyModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
