import { parseEnv } from './env.schema';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGIN: 'http://localhost:5173',
  LOG_LEVEL: 'info',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

describe('parseEnv', () => {
  it('parses a valid environment, coercing PORT to a number', () => {
    const env = parseEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  it('defaults NODE_ENV, PORT, and LOG_LEVEL when omitted', () => {
    const rest = omit(omit(omit(validEnv, 'NODE_ENV'), 'PORT'), 'LOG_LEVEL');
    const env = parseEnv(rest);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('fails fast with a readable message when a required var is missing', () => {
    expect(() => parseEnv(omit(validEnv, 'DATABASE_URL'))).toThrow(
      /DATABASE_URL/,
    );
  });

  it('fails fast when a var is present but malformed', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'not-a-url' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
