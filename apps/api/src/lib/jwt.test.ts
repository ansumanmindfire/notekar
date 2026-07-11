import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signAccessToken, verifyAccessToken } from './jwt';

const SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(32);

describe('signAccessToken / verifyAccessToken', () => {
  it('round-trips: verifying a freshly signed token returns the same userId as sub', () => {
    const userId = 'user-123';
    const token = signAccessToken(userId, SECRET);

    const payload = verifyAccessToken(token, SECRET);

    expect(payload.sub).toBe(userId);
  });

  it('throws when verifying a token signed with a different secret', () => {
    const token = signAccessToken('user-123', SECRET);

    expect(() => verifyAccessToken(token, OTHER_SECRET)).toThrow();
  });

  it('throws when verifying an expired token', () => {
    // Sign a token that is already expired via the jsonwebtoken library
    // directly with a negative expiresIn, rather than relying on fake
    // timers (jsonwebtoken reads Date.now() internally at call time, and
    // a negative TTL is a simpler, deterministic way to force expiry).
    const expiredToken = jwt.sign({ sub: 'user-123' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: -10,
    });

    expect(() => verifyAccessToken(expiredToken, SECRET)).toThrow();
  });

  it('throws when verifying a garbage/malformed string that is not a JWT', () => {
    expect(() => verifyAccessToken('not-a-jwt-at-all', SECRET)).toThrow();
  });
});
