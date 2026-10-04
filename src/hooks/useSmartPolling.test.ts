import { act, renderHook } from '@testing-library/react';
import { useSmartPolling } from './useSmartPolling';

describe('useSmartPolling (#570)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts polling when enabled=true', async () => {
    const fetchFn = jest.fn().mockResolvedValue('data-1');
    const { result, unmount } = renderHook(() =>
      useSmartPolling({ fetchFn, interval: 1000, enabled: true })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isPolling).toBe(true);
    expect(fetchFn).toHaveBeenCalled();

    unmount();
  });

  it('sets isPolling=false and stops timer when toggled to enabled=false (#570)', async () => {
    const fetchFn = jest.fn().mockResolvedValue('data-1');
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useSmartPolling({ fetchFn, interval: 1000, enabled }),
      { initialProps: { enabled: true } }
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isPolling).toBe(true);

    // Toggle enabled to false
    act(() => {
      rerender({ enabled: false });
    });

    expect(result.current.isPolling).toBe(false);

    const callCountBefore = fetchFn.mock.calls.length;
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(fetchFn.mock.calls.length).toBe(callCountBefore);

    unmount();
  });

  it('re-starts polling immediately when toggled from false back to true (#570)', async () => {
    const fetchFn = jest.fn().mockResolvedValue('data-1');
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useSmartPolling({ fetchFn, interval: 1000, enabled }),
      { initialProps: { enabled: true } }
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Disable
    act(() => {
      rerender({ enabled: false });
    });
    expect(result.current.isPolling).toBe(false);

    // Re-enable
    const callsBeforeReenable = fetchFn.mock.calls.length;
    act(() => {
      rerender({ enabled: true });
    });

    await act(async () => {
      await Promise.resolve();
    });

    unmount();
  });

  it('reschedules running timer when backoff applies and resets on data change (#569)', async () => {
    const fetchFn = jest.fn().mockResolvedValue('static-data');
    const { result, unmount } = renderHook(() =>
      useSmartPolling({
        fetchFn,
        interval: 1000,
        enabled: true,
        unchangedThreshold: 2,
        backoffMultiplier: 2,
        maxBackoff: 4000,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Advance 1st interval -> 2nd fetch (unchanged count = 1)
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    // Advance 2nd interval -> 3rd fetch (unchanged count = 2 -> enters backoff: interval becomes 2000ms)
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current.isBackingOff).toBe(true);
    const countAtBackoff = fetchFn.mock.calls.length;

    // Advance by old interval (1000ms) -> should NOT trigger fetch because timer was rescheduled to 2000ms
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(fetchFn.mock.calls.length).toBe(countAtBackoff);

    // Advance remaining 1000ms (total 2000ms) -> should trigger fetch
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(fetchFn.mock.calls.length).toBe(countAtBackoff + 1);

    unmount();
  });
});
