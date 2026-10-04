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

    expect(result.current.isPolling).toBe(true);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsBeforeReenable);

    unmount();
  });
});
