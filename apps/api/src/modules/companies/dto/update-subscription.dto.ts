import { createZodDto } from 'nestjs-zod';
import { updateSubscriptionSchema } from '@repo/types/subscriptions';

export class UpdateSubscriptionDto extends createZodDto(
  updateSubscriptionSchema,
) {}
