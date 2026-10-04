import { renderHook, act, waitFor } from '@testing-library/react';
import { useBountyStatus } from './useBountyStatus';
import { fetchLiveBounty } from '@/lib/api';
import type { Bounty } from '@/types/bounty';

jest.mock('@/lib/api', () => ({
  fetchBounty: jest.fn(),
  fetchLiveBounty: jest.fn(),
}));

const mockFetchLiveBounty = fetchLiveBounty as jest.MockedFunction<typeof fetchLiveBounty>;

const mockLiveBounty: Bounty = {
  id: 'bounty-123',
  title: 'Test Bounty',
  amount: '100',
  asset: 'XLM',
  status: 'claimed',
  claimedBy: 'user-1',
  sponsor: 'sponsor-1',
  issueUrl: 'https://github.com/org/repo/issues/1',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

const mockFallbackBounty: Bounty = {
  id: 'bounty-123',
  title: 'Test Bounty Fallback',
  amount: '100',
  asset: 'XLM',
  status: 'open',
  claimedBy: undefined,
  sponsor: 'sponsor-1',
  issueUrl: 'https://github.com/org/repo/issues/1',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

describe('useBountyStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves live bounty data and sets error on transient poll failure (#571)', async () => {
    // 1. Initial poll succeeds with live data (claimed)
    mockFetchLiveBounty.mockResolvedValueOnce({
      data: mockLiveBounty,
      source: 'live',
    });

    const onStatusChange = jest.fn();

    const { result } = renderHook(() =>
      useBountyStatus({
        bountyId: 'bounty-123',
        fallbackBounty: mockFallbackBounty,
        onStatusChange,
      }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('claimed');
      expect(result.current.source).toBe('live');
    });

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith('claimed');
    onStatusChange.mockClear();

    // 2. Subsequent poll fails with a network error
    mockFetchLiveBounty.mockRejectedValueOnce(new Error('Network drop'));

    await act(async () => {
      await result.current.refetch();
    });

    // Verify: status is still claimed, onStatusChange was not called with fallback open status, and error is set
    expect(result.current.status).toBe('claimed');
    expect(result.current.bounty).toEqual(mockLiveBounty);
    expect(result.current.source).toBe('live');
    expect(result.current.error).toBeDefined();
    expect(result.current.error?.message).toBe('Network drop');
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('falls back to mock data on initial fetch failure when fallbackBounty is provided', async () => {
    mockFetchLiveBounty.mockRejectedValueOnce(new Error('Backend offline'));

    const { result } = renderHook(() =>
      useBountyStatus({
        bountyId: 'bounty-123',
        fallbackBounty: mockFallbackBounty,
      }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('open');
      expect(result.current.source).toBe('mock');
      expect(result.current.bounty).toEqual(mockFallbackBounty);
    });
  });
});
