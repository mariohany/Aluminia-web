import { createZodDto } from 'nestjs-zod';
import {
  solveProgressSchema,
  solveResultSchema,
  startSolveSchema,
  stopSolveSchema,
} from '@repo/types/reports';

// docs/browser_solve_planing.md §7.

export class StartSolveDto extends createZodDto(startSolveSchema) {}
export class SolveProgressDto extends createZodDto(solveProgressSchema) {}
export class SolveResultDto extends createZodDto(solveResultSchema) {}
export class StopSolveDto extends createZodDto(stopSolveSchema) {}
