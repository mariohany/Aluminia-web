import { createZodDto } from 'nestjs-zod';
import { updateClientSchema } from '@repo/types/clients';

export class UpdateClientDto extends createZodDto(updateClientSchema) {}
