import { createZodDto } from 'nestjs-zod';
import { moveWindowsSchema } from '@repo/types/windows';

export class MoveWindowsDto extends createZodDto(moveWindowsSchema) {}
