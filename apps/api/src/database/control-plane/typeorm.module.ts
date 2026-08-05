import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { controlPlaneDataSourceOptions } from './data-source';

@Module({
  imports: [TypeOrmModule.forRoot(controlPlaneDataSourceOptions)],
})
export class ControlPlaneDatabaseModule {}
