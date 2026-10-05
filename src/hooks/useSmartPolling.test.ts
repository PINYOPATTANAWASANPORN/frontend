import { renderHook, act } from '@testing-library/react';
import { useSmartPolling } from './useSmartPolling';

describe('useSmartPolling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('starts polling when enabled=true and fetches initial data', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ status: 'active' });
    const { result } = renderHook(() =>
      useSmartPolling({ fetchFn, interval: 1000, enabled: true })
    );

    expect(result.current.isPolling).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({ status: 'active' });
  });

  it('stops polling and sets isPolling=false when enabled is toggled to false', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ count: 1 });
    let isEnabled = true;

    const { result, rerender } = renderHook(() =>
      useSmartPolling({ fetchFn, interval: 1000, enabled: isEnabled })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isPolling).toBe(true);

    // Toggle off
    isEnabled = false;
    rerender();

    expect(result.current.isPolling).toBe(false);

    // Fast-forward time, verify no additional polls
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('restarts polling when enabled is toggled back to true', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ count: 1 });
    let isEnabled = false;

    const { result, rerender } = renderHook(() =>
      useSmartPolling({ fetchFn, interval: 1000, enabled: isEnabled })
    );

    expect(result.current.isPolling).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();

    // Toggle on
    isEnabled = true;
    rerender();

    expect(result.current.isPolling).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Verify interval fires
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('stabilizes inline callback changes across renders', async () => {
    let count = 0;
    const { result, rerender } = renderHook(() =>
      useSmartPolling({
        fetchFn: async () => ({ val: ++count }),
        interval: 1000,
        enabled: true,
        onDataChange: jest.fn(),
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isPolling).toBe(true);

    // Re-render multiple times with new inline closures
    rerender();
    rerender();

    expect(result.current.isPolling).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current.data).toEqual({ val: 2 });
  });
});
