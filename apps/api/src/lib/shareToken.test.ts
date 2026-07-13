import { describe, it, expect } from 'vitest';
import { generateShareToken } from './shareToken';

describe('generateShareToken', () => {
  it('returns a 32-character base64url string (URL-safe, no padding)', () => {
    const token = generateShareToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('produces different values across calls (collision sanity check)', () => {
    const first = generateShareToken();
    const second = generateShareToken();

    expect(first).not.toBe(second);
  });
});
