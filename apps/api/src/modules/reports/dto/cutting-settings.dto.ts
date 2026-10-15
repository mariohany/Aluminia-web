import { createZodDto } from 'nestjs-zod';
import { cuttingSettingsSchema } from '@repo/types/reports';

export class CuttingSettingsDto extends createZodDto(cuttingSettingsSchema) {}
