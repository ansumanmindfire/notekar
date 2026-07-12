import { describe, it, expect, vi } from 'vitest';

// randomInt is a named export of the node:crypto built-in, so it can't be
// spied on directly in ESM (the module namespace object is not
// configurable). Instead we mock the whole module, wrapping the *actual*
// randomInt as the default vi.fn() implementation so every test that
// doesn't explicitly override it (the statistical ones below) still
// exercises real randomness. Declared before the dynamic imports below so
// generateOtp/randomInt resolve against the mocked module, mirroring the
// hoisted-mock-then-dynamic-import pattern used in auth.controller.test.ts.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomInt: vi.fn((min: number, max: number) => actual.randomInt(min, max)),
  };
});

const { generateOtp } = await import('./otp');

// node:crypto's `randomInt` is an overloaded declaration (a synchronous
// `(min, max) => number` overload plus callback-style overloads that return
// `void`). When TypeScript widens an overloaded function reference for
// generic inference (as `vi.mocked` does), it resolves to the *last*
// declared overload — here the callback form returning `void` — which makes
// `mockReturnValueOnce(5)` below fail to type-check against a `void`-typed
// mock. Casting to the single synchronous signature we actually use (which
// matches the arrow wrapper's shape in the mock factory above) resolves the
// ambiguity without altering runtime behavior: this binding still points at
// the same vi.fn() mock installed by vi.mock('node:crypto', ...) above.
const { randomInt } = (await import('node:crypto')) as unknown as {
  randomInt: (min: number, max: number) => number;
};

const SAMPLE_SIZE = 500;

describe('generateOtp', () => {
  it('returns a 6-character string of digits only', () => {
    const otp = generateOtp();

    expect(otp).toMatch(/^[0-9]{6}$/);
  });

  it('always returns exactly 6 digits across many calls, including zero-padded low values', () => {
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const otp = generateOtp();

      expect(otp).toHaveLength(6);
      expect(otp).toMatch(/^[0-9]{6}$/);
    }
  });

  it('produces varying values across calls (collision sanity check)', () => {
    const codes = new Set<string>();

    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      codes.add(generateOtp());
    }

    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('generateOtp - deterministic zero-padding', () => {
  it('returns "000005" when randomInt is forced to return 5', () => {
    // mockReturnValueOnce affects only this single call, so the mock falls
    // straight back to the wrapped real randomInt afterwards — no
    // restore/reset needed, and the statistical tests above are unaffected
    // regardless of execution order.
    vi.mocked(randomInt).mockReturnValueOnce(5);

    const otp = generateOtp();

    expect(otp).toBe('000005');
  });
});
