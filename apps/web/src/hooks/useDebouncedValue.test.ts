import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

// AB-1013 - SearchPage debounces the search input by DELAY_MS before it reaches
// useSearchQuery, so an intermediate keystroke never fires a request of its own.
// This hook is the single source of that behavior; SearchPage.test.tsx exercises
// it end-to-end, but the exact-timing / no-intermediate-update guarantees are
// asserted directly against the hook here (mirroring useAutosave.test.ts's
// vi.useFakeTimers() debounce-testing pattern).

const DELAY_MS = 400;

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately, with no debounce delay on mount', () => {
    const { result } = renderHook(() => useDebouncedValue('initial', DELAY_MS));

    expect(result.current).toBe('initial');
  });

  it('does not update the debounced value until the full delay has elapsed', () => {
    const { result, rerender } = renderHook(
      (props: { value: string }) => useDebouncedValue(props.value, DELAY_MS),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(DELAY_MS - 1);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('b');
  });

  it('settles on only the final value after rapid successive changes - no intermediate value is ever returned', () => {
    const { result, rerender } = renderHook(
      (props: { value: string }) => useDebouncedValue(props.value, DELAY_MS),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: 'abc' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: 'abcd' });

    // Each rerender restarts the debounce window (the effect's cleanup clears the
    // previous timer), so 400ms has never elapsed uninterrupted since the initial
    // mount - the value must still be the original one, not any of the intermediate
    // 'ab'/'abc' values.
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(DELAY_MS);
    });

    expect(result.current).toBe('abcd');
  });

  it('restarts the delay window when delayMs itself changes mid-debounce', () => {
    const { result, rerender } = renderHook(
      (props: { value: string; delayMs: number }) => useDebouncedValue(props.value, props.delayMs),
      { initialProps: { value: 'a', delayMs: DELAY_MS } },
    );

    rerender({ value: 'b', delayMs: DELAY_MS });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS - 1);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('b');
  });
});
