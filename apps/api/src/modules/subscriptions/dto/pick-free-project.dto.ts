import { createZodDto } from 'nestjs-zod';
import { pickFreeProjectSchema } from '@repo/types/subscriptions';

export class PickFreeProjectDto extends createZodDto(pickFreeProjectSchema) {}
