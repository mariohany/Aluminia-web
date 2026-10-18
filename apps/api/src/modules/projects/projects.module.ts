import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/control-plane/entities/user.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

// No tenant TypeOrmModule.forFeature — same reason as ClientsModule: a
// tenant repository binds to one schema at construction time, which is
// exactly what must not happen here. `User` is the control-plane one: the
// "created" status event snapshots the creator's email.
@Module({
  imports: [TypeOrmModule.forFeature([User]), TenancyModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
