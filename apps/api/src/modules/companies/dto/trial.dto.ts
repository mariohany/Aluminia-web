import { createZodDto } from 'nestjs-zod';
import {
  endTrialSchema,
  extendTrialSchema,
  grantTrialSchema,
} from '@repo/types/subscriptions';

export class GrantTrialDto extends createZodDto(grantTrialSchema) {}
export class ExtendTrialDto extends createZodDto(extendTrialSchema) {}
export class EndTrialDto extends createZodDto(endTrialSchema) {}
