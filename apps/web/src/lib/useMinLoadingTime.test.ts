import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMinLoadingTime } from './useMinLoadingTime';

describe('useMinLoadingTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true immediately whenever isLoading is true', () => {
    const { result } = renderHook(() => useMinLoadingTime(true));

    expect(result.current).toBe(true);
  });

  it('returns false immediately when isLoading has always been false (never started loading)', () => {
    const { result } = renderHook(() => useMinLoadingTime(false));

    expect(result.current).toBe(false);
  });

  it('stays true through the 200ms window even when loading resolves on the very next tick', () => {
    const { result, rerender } = renderHook(({ isLoading }) => useMinLoadingTime(isLoading), {
      initialProps: { isLoading: true },
    });

    expect(result.current).toBe(true);

    // Loading resolves almost instantly.
    act(() => {
      rerender({ isLoading: false });
    });

    // Still must read true immediately after the flip.
    expect(result.current).toBe(true);

    // Advance most of the window - still true.
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe(true);
  });

  it('becomes false only after the full 200ms window (measured from load start) has elapsed', () => {
    const { result, rerender } = renderHook(({ isLoading }) => useMinLoadingTime(isLoading), {
      initialProps: { isLoading: true },
    });

    act(() => {
      rerender({ isLoading: false });
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toBe(false);
  });

  it('honors a custom minMs window instead of the 200ms default', () => {
    const { result, rerender } = renderHook(({ isLoading }) => useMinLoadingTime(isLoading, 500), {
      initialProps: { isLoading: true },
    });

    act(() => {
      rerender({ isLoading: false });
    });

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it('does not hold true past the window when loading takes longer than minMs to resolve', () => {
    const { result, rerender } = renderHook(({ isLoading }) => useMinLoadingTime(isLoading), {
      initialProps: { isLoading: true },
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe(true);

    act(() => {
      rerender({ isLoading: false });
    });

    // Loading already exceeded minMs, so no extra hold is needed.
    expect(result.current).toBe(false);
  });
});
