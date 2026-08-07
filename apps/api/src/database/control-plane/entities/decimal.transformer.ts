import { ValueTransformer } from 'typeorm';

// node-postgres returns numeric columns as strings to avoid silent
// precision loss on the wire. The rest of this app treats prices as
// plain numbers (Zod `z.number()`, JSON), so convert at this boundary
// rather than pushing string-vs-number handling into every caller.
export const decimalTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : Number(value),
};
