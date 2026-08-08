import { createZodDto } from 'nestjs-zod';
import { deleteClientSchema } from '@repo/types/clients';

export class DeleteClientDto extends createZodDto(deleteClientSchema) {}
