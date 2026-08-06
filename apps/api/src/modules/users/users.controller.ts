import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type { UserSummary } from '@repo/types/users';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { DeleteUserDto } from './dto/delete-user.dto';

@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserSummary[]> {
    return this.users.list();
  }

  @Post()
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<UserSummary> {
    return this.users.create(dto, actor.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<UserSummary> {
    return this.users.update(id, dto, actor.id);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<UserSummary> {
    return this.users.deactivate(id, actor.id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<UserSummary> {
    return this.users.reactivate(id, actor.id);
  }

  @Post(':id/reset-password')
  @HttpCode(204)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetUserPasswordDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.users.resetPassword(id, dto.password, actor.id);
  }

  @Post(':id/end-session')
  @HttpCode(204)
  async endSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.users.endSession(id, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteUserDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.users.remove(id, dto.confirmEmail, actor.id);
  }
}
