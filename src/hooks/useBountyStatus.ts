import { useRef } from 'react';
import { useSmartPolling } from './useSmartPolling';
import { fetchBounty, fetchLiveBounty } from '@/lib/api';
import type { Bounty, BountyStatus } from '@/types/bounty';

interface UseBountyStatusOptions {
  bountyId: string;
  fallbackBounty?: Bounty;
  interval?: number;
  enabled?: boolean;
  onStatusChange?: (status: BountyStatus) => void;
}

interface UseBountyStatusResult {
  bounty: Bounty | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  isPolling: boolean;
  isLive: boolean;
  status: BountyStatus | null;
  source: 'live' | 'mock' | null;
}

export function useBountyStatus({
  bountyId,
  fallbackBounty,
  interval = 5000,
  enabled = true,
  onStatusChange,
}: UseBountyStatusOptions): UseBountyStatusResult {
  const hasLiveRef = useRef(false);
  const lastBountyIdRef = useRef(bountyId);

  if (lastBountyIdRef.current !== bountyId) {
    lastBountyIdRef.current = bountyId;
    hasLiveRef.current = false;
  }

  const {
    data,
    isLoading,
    error,
    refetch,
    isPolling,
    isBackingOff,
  } = useSmartPolling<{ data: Bounty | undefined; source: 'live' | 'mock' }>({
    fetchFn: async () => {
      if (hasLiveRef.current) {
        return await fetchLiveBounty(bountyId);
      }
      try {
        const result = await fetchLiveBounty(bountyId);
        hasLiveRef.current = true;
        return result;
      } catch (err) {
        if (fallbackBounty !== undefined) {
          return { data: fallbackBounty, source: 'mock' };
        }
        throw err;
      }
    },
    interval,
    enabled,
    backoffMultiplier: 1.5,
    maxBackoff: 30000,
    unchangedThreshold: 3,
    compareFn: (a, b) => {
      const aStatus = a?.data?.status;
      const bStatus = b?.data?.status;
      return aStatus === bStatus && a?.data?.claimedBy === b?.data?.claimedBy;
    },
    onDataChange: (result) => {
      if (onStatusChange && result?.data?.status) {
        onStatusChange(result.data.status);
      }
    },
  });

  return {
    bounty: data?.data || null,
    isLoading,
    error,
    refetch,
    isPolling,
    isLive: isPolling && !isBackingOff,
    status: data?.data?.status || null,
    source: data?.source || null,
  };
}
