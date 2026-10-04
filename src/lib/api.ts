import { API_BASE_URL } from "./config";
import { getToken } from "./auth";
import {
  adaptBounty,
  adaptMilestone,
  adaptMaintenancePool,
  adaptReputation,
  type RawBounty,
  type RawMilestone,
  type RawMaintenancePool,
  type RawReputationSnapshot,
  type RawUserProfile,
} from "./adapters";
import type { Bounty, Milestone, MaintenancePool, ReputationProfile } from "@/types";
import { buildBountyQueryString, type BountyQuery } from "./bounty-query";

export class ApiUnavailableError extends Error {}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

/**
 * Distinguishes live backend data from mock fallback so callers can surface
 * a visible indicator without relying on fragile reference-identity checks.
 */
export interface FetchResult<T> {
  data: T;
  source: "live" | "mock";
}

function logFetchError(path: string, kind: "network" | "http" | "parse", detail: string) {
  console.error(`[api] ${kind} error on ${path}: ${detail}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: init?.signal ?? timeout,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      logFetchError(path, "network", "Request timed out");
      throw new ApiUnavailableError(`Request to ${path} timed out`);
    }
    logFetchError(path, "network", err instanceof Error ? err.message : String(err));
    throw new ApiUnavailableError(`Network error on ${path}`);
  }
  if (!res.ok) {
    logFetchError(path, "http", `${res.status} ${res.statusText}`);
    throw new ApiUnavailableError(`Request to ${path} failed: ${res.status}`);
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    logFetchError(path, "parse", err instanceof Error ? err.message : String(err));
    throw new ApiUnavailableError(`Invalid JSON from ${path}`);
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// In-flight request deduplication (#44)
// ---------------------------------------------------------------------------
// Maps a request signature (method + path + body hash) to the in-flight
// Promise so rapid double-clicks on the same mutation coalesce into one
// network request instead of two.

const inflight = new Map<string, Promise<unknown>>();

function requestKey(method: string, path: string, body?: string): string {
  return `${method}:${path}:${body ?? ""}`;
}

async function dedupedFetch<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export function parseRetryAfter(header: string): number | undefined {
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    return Number.isFinite(sec) && sec >= 0 ? sec : undefined;
  }
  if (!trimmed.includes("GMT") && !trimmed.includes(",")) {
    return undefined;
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return undefined;
}

/**
 * Client-side call that attaches the signed-in user's JWT (if any) and
 * surfaces backend error bodies instead of silently falling back — used for
 * actions the user explicitly triggers (claim, fund, deposit, ...), where
 * hiding a failure behind mock data would be misleading.
 */
export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const bodyStr = init?.body != null ? String(init.body) : undefined;
  const key = requestKey(init?.method ?? "GET", path, bodyStr);

  return dedupedFetch(key, async () => {
    const token = getToken();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
        signal: init?.signal ?? timeout,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new ApiRequestError("Request timed out — please try again.", 0);
      }
      throw err;
    }

    // --- Rate-limit handling (#44) ---
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const seconds = retryAfter ? parseRetryAfter(retryAfter) : undefined;
      const waitMsg = seconds !== undefined
        ? ` Please wait ${seconds} second${seconds === 1 ? "" : "s"} before trying again.`
        : "";
      throw new ApiRequestError(
        `You're doing that too fast.${waitMsg}`,
        429,
        seconds,
      );
    }

    if (!res.ok) {
      const body = await res.text();
      let message = body;
      try {
        const parsed = JSON.parse(body);
        // A JSON body without a `.message` (e.g. a NestJS validation error
        // shaped like `{statusCode,error,details}`) must not fall back to the
        // raw JSON text — that would get rendered verbatim in the UI (#187).
        message = parsed.message ?? `Request failed (${res.status})`;
      } catch {
        // plain-text error body, use as-is
      }
      throw new ApiRequestError(message || `Request failed (${res.status})`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Live-data fetchers that adapt mergefi-backend's nested TypeORM entity JSON
 * into the flat shapes the UI renders, falling back to mock data (already in
 * the target shape) when the backend is unreachable.
 */
/**
 * `query`, if given, is forwarded to the backend as query params (#28) so
 * this is ready for server-side filtering once `/bounties` supports it —
 * today the backend ignores unknown params and returns the full unfiltered
 * collection, which callers must still run through
 * `applyBountyQuery`/`filterBounties` themselves (see src/lib/bounty-query.ts)
 * to get correct behavior against both live and mock-fallback data.
 */
export async function fetchBounties(
  fallback: Bounty[],
  query?: BountyQuery,
): Promise<FetchResult<Bounty[]>> {
  const qs = query ? buildBountyQueryString(query) : "";
  try {
    const raw = await request<RawBounty[]>(`/bounties${qs}`);
    return { data: raw.map(adaptBounty), source: "live" };
  } catch {
    return { data: fallback, source: "mock" };
  }
}

export async function fetchBounty(
  id: string,
  fallback: Bounty | undefined,
): Promise<FetchResult<Bounty | undefined>> {
  try {
    const raw = await request<RawBounty>(`/bounties/${id}`);
    return { data: adaptBounty(raw), source: "live" };
  } catch {
    return { data: fallback, source: "mock" };
  }
}

export async function fetchMilestones(fallback: Milestone[]): Promise<FetchResult<Milestone[]>> {
  try {
    const raw = await request<RawMilestone[]>("/milestones");
    return { data: raw.map(adaptMilestone), source: "live" };
  } catch {
    return { data: fallback, source: "mock" };
  }
}

export async function fetchMaintenancePools(
  fallback: MaintenancePool[],
): Promise<FetchResult<MaintenancePool[]>> {
  try {
    const raw = await request<RawMaintenancePool[]>("/maintenance-pools");
    return { data: raw.map(adaptMaintenancePool), source: "live" };
  } catch {
    return { data: fallback, source: "mock" };
  }
}

export async function fetchReputationByUsername(
  username: string,
  fallback: ReputationProfile | null,
): Promise<FetchResult<ReputationProfile | null>> {
  try {
    const users = await request<(RawUserProfile & { id: string })[]>("/users");
    const target = username.toLowerCase();
    const user = users.find((u) => u.username.toLowerCase() === target);
    if (!user) return { data: fallback, source: "mock" };
    const snapshot = await request<RawReputationSnapshot | null>(
      `/reputation/${user.id}`,
    );
    return { data: adaptReputation(user, snapshot), source: "live" };
  } catch {
    return { data: fallback, source: "mock" };
  }
}

/**
 * Handles eligible to appear in the sitemap — i.e. profiles whose owner has
 * opted into search-engine indexing.
 *
 * The filter is the enforcement point for the privacy policy documented in
 * src/lib/seo-policy.ts: without it, calling the /users endpoint to enumerate
 * handles builds a crawlable directory of who earns what, tied to real GitHub
 * identities. Anything other than an explicit `isProfilePublic: true` is
 * excluded, so the endpoint omitting the field (as it does today) means
 * nothing is indexed rather than everything.
 */
export async function fetchIndexableReputationHandles(
  fallback: string[],
): Promise<FetchResult<string[]>> {
  try {
    const users = await request<(RawUserProfile & { id: string })[]>("/users");
    return {
      data: users
        .filter((user) => user.isProfilePublic === true)
        .map((user) => user.username)
        .filter(Boolean),
      source: "live",
    };
  } catch {
    // The mock fixtures represent contributors who have opted in, so local
    // development exercises the same code path production will take once the
    // backend ships the flag.
    return { data: fallback, source: "mock" };
  }
}
