import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  // A hash of a random password nobody knows, made once with the same
  // settings as real ones, so verifying against it costs the same.
  // Made at startup, so the first unknown-email login isn't the one
  // that pays for hashing it (and stands out by taking twice as long).
  private dummyHash: Promise<string> | null = null;

  onModuleInit(): void {
    this.dummyHash = this.hash(randomBytes(32).toString('hex'));
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }

  /** Does a real verify's argon2 work and always fails — for a login
   * whose email has no account (stability S16). */
  async verifyDummy(plain: string): Promise<false> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('hex'));
    await argon2.verify(await this.dummyHash, plain);
    return false;
  }
}
