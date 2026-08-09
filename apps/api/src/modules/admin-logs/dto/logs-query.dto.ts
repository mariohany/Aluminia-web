import { createZodDto } from 'nestjs-zod';
import { logsQuerySchema } from '@repo/types/logs';

export class LogsQueryDto extends createZodDto(logsQuerySchema) {}
