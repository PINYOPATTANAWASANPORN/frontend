import { renderHook, act } from '@testing-library/react';
import { useBountyStatus } from './useBountyStatus';
import { fetchLiveBounty } from '@/lib/api';
import type { Bounty } from '@/types/bounty';

jest.mock('@/lib/api', () => ({
  fetchLiveBounty: jest.fn(),
  fetchBounty: jest.fn(),
}));

const mockFetchLiveBounty = fetchLiveBounty as jest.MockedFunction<typeof fetchLiveBounty>;

describe('useBountyStatus', () => {
  const fallbackBounty: Bounty = {
    id: 'b1',
    title: 'Test Bounty',
    description: 'Desc',
    amount: '100',
    token: 'USDC',
    status: 'open',
    sponsorId: 's1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };

  const liveBountyClaimed: Bounty = {
    ...fallbackBounty,
    status: 'claimed',
    claimedBy: 'developer-1',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('uses fallbackBounty on initial mount if network request fails', async () => {
    mockFetchLiveBounty.mockRejectedValueOnce(new Error('Network offline'));

    const { result } = renderHook(() =>
      useBountyStatus({ bountyId: 'b1', fallbackBounty })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.bounty).toEqual(fallbackBounty);
    expect(result.current.source).toBe('mock');
  });

  it('preserves live status and throws error without swapping fallback on transient poll errors', async () => {
    const onStatusChange = jest.fn();
    mockFetchLiveBounty.mockResolvedValueOnce({ data: liveBountyClaimed, source: 'live' });

    const { result } = renderHook(() =>
      useBountyStatus({
        bountyId: 'b1',
        fallbackBounty,
        interval: 1000,
        onStatusChange,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('claimed');
    expect(result.current.source).toBe('live');
    expect(onStatusChange).toHaveBeenCalledWith('claimed');
    onStatusChange.mockClear();

    // Simulate transient network failure on 2nd poll
    mockFetchLiveBounty.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    // Bounty state must remain 'claimed' and not revert to fallback 'open'
    expect(result.current.status).toBe('claimed');
    expect(result.current.error).toBeTruthy();
    expect(onStatusChange).not.toHaveBeenCalled();

    // Simulate recovery on 3rd poll
    mockFetchLiveBounty.mockResolvedValueOnce({ data: liveBountyClaimed, source: 'live' });

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current.status).toBe('claimed');
    expect(result.current.error).toBeNull();
  });
});
