import { createZodDto } from 'nestjs-zod';
import { createClientSchema } from '@repo/types/clients';

export class CreateClientDto extends createZodDto(createClientSchema) {}
