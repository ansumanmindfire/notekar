import { describe, it, expect } from 'vitest';
import { generateOpaqueToken, hashToken } from './refreshToken';

describe('generateOpaqueToken', () => {
  it('returns a 64-character lowercase hex string', () => {
    const token = generateOpaqueToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different values across calls (collision sanity check)', () => {
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();

    expect(first).not.toBe(second);
  });
});

describe('hashToken', () => {
  it('is deterministic: the same input always produces the same output hash', () => {
    const raw = 'a-sample-raw-token-value';

    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it('returns a 64-character hex string (SHA-256 hex digest length)', () => {
    const hash = hashToken('some-raw-token');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    const hashA = hashToken('token-a');
    const hashB = hashToken('token-b');

    expect(hashA).not.toBe(hashB);
  });
});
