import { createZodDto } from 'nestjs-zod';
import { quoteRequestSchema } from '@repo/types/quote-request';

export class CreateLeadDto extends createZodDto(quoteRequestSchema) {}
