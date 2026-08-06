import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '../../database/control-plane/entities/user.entity';
import { Session } from '../../database/control-plane/entities/session.entity';
import { Company } from '../../database/control-plane/entities/company.entity';
import type { Env } from '../../config/env.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Session, Company]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    // Protected by default across the whole app — registered globally
    // here rather than per-controller, with @Public() as the opt-out.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Runs after JwtAuthGuard (global guards execute in provider
    // registration order), so request.user is populated by the time
    // this checks @Roles(). Routes without @Roles() are unrestricted.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [PasswordService],
})
export class AuthModule {}
