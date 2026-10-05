import { useEffect, useState, useRef, useCallback, useReducer } from 'react';

export interface UseSmartPollingOptions<T> {
  fetchFn: () => Promise<T>;
  interval?: number;
  enabled?: boolean;
  backoffMultiplier?: number;
  maxBackoff?: number;
  unchangedThreshold?: number;
  compareFn?: (a: T, b: T) => boolean;
  onDataChange?: (data: T) => void;
}

export interface UseSmartPollingResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  isPolling: boolean;
  isBackingOff: boolean;
}

type PollingState = {
  isPolling: boolean;
  isBackingOff: boolean;
};

type PollingAction = 
  | { type: 'START_POLLING' }
  | { type: 'STOP_POLLING' }
  | { type: 'START_BACKOFF' }
  | { type: 'STOP_BACKOFF' };

const pollingInitialState: PollingState = {
  isPolling: false,
  isBackingOff: false,
};

function pollingReducer(state: PollingState, action: PollingAction): PollingState {
  switch (action.type) {
    case 'START_POLLING':
      return { ...state, isPolling: true };
    case 'STOP_POLLING':
      return { ...state, isPolling: false, isBackingOff: false };
    case 'START_BACKOFF':
      return { ...state, isBackingOff: true };
    case 'STOP_BACKOFF':
      return { ...state, isBackingOff: false };
    default:
      return state;
  }
}

export function useSmartPolling<T>({
  fetchFn,
  interval = 5000,
  enabled = true,
  backoffMultiplier = 1.5,
  maxBackoff = 30000,
  unchangedThreshold = 3,
  compareFn = (a, b) => JSON.stringify(a) === JSON.stringify(b),
  onDataChange,
}: UseSmartPollingOptions<T>): UseSmartPollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [pollingState, dispatch] = useReducer(pollingReducer, pollingInitialState);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentIntervalRef = useRef(interval);
  const unchangedCountRef = useRef(0);
  const isMountedRef = useRef(true);
  const previousDataRef = useRef<T | null>(null);
  const isBackgroundedRef = useRef(false);

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  const compareFnRef = useRef(compareFn);
  compareFnRef.current = compareFn;
  const onDataChangeRef = useRef(onDataChange);
  onDataChangeRef.current = onDataChange;

  const fetchData = useCallback(async () => {
    if (!isMountedRef.current) return;
    
    try {
      setIsLoading(true);
      const result = await fetchFnRef.current();
      
      if (!isMountedRef.current) return;

      const hasChanged = previousDataRef.current !== null 
        ? !compareFnRef.current(previousDataRef.current, result)
        : true;

      if (hasChanged) {
        setData(result);
        previousDataRef.current = result;
        unchangedCountRef.current = 0;
        currentIntervalRef.current = interval;
        dispatch({ type: 'STOP_BACKOFF' });
        onDataChangeRef.current?.(result);
      } else {
        unchangedCountRef.current += 1;
        
        if (unchangedCountRef.current >= unchangedThreshold) {
          const newInterval = Math.min(
            currentIntervalRef.current * backoffMultiplier,
            maxBackoff
          );
          if (newInterval > currentIntervalRef.current) {
            currentIntervalRef.current = newInterval;
            dispatch({ type: 'START_BACKOFF' });
            if (intervalRef.current && !isBackgroundedRef.current && enabled) {
              clearInterval(intervalRef.current);
              intervalRef.current = setInterval(fetchData, currentIntervalRef.current);
            }
          }
        }
      }

      setError(null);
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Polling failed'));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [interval, backoffMultiplier, maxBackoff, unchangedThreshold, enabled]);

  const refetch = useCallback(async () => {
    currentIntervalRef.current = interval;
    dispatch({ type: 'STOP_BACKOFF' });
    unchangedCountRef.current = 0;
    await fetchData();
  }, [fetchData, interval]);

  // Handle visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      isBackgroundedRef.current = document.hidden;
      
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        dispatch({ type: 'STOP_POLLING' });
      } else if (enabled) {
        dispatch({ type: 'START_POLLING' });
        fetchData();
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = setInterval(fetchData, currentIntervalRef.current);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, fetchData]);

  // Main polling effect responding deterministically to enabled state
  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      dispatch({ type: 'STOP_POLLING' });
      return;
    }

    dispatch({ type: 'START_POLLING' });
    fetchData();

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(fetchData, currentIntervalRef.current);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      dispatch({ type: 'STOP_POLLING' });
    };
  }, [enabled, fetchData]);

  return {
    data,
    isLoading,
    error,
    refetch,
    isPolling: pollingState.isPolling,
    isBackingOff: pollingState.isBackingOff,
  };
}
