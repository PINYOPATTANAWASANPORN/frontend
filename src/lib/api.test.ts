import { fetchIndexableReputationHandles } from "./api";

/**
 * The privacy filter in fetchIndexableReputationHandles is the point where a
 * crawlable directory of contributor earnings is prevented from existing at
 * all, so it's tested against the real HTTP path rather than a mock.
 */
describe("fetchIndexableReputationHandles", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  function mockUsersResponse(users: unknown) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => users,
    }) as unknown as typeof fetch;
  }

  it("returns only profiles that explicitly opted in", async () => {
    mockUsersResponse([
      { id: "1", username: "public-priya", isProfilePublic: true },
      { id: "2", username: "private-koda", isProfilePublic: false },
      { id: "3", username: "unspecified-ana" },
      { id: "4", username: "null-flag-marcus", isProfilePublic: null },
    ]);

    const result = await fetchIndexableReputationHandles([]);

    expect(result.source).toBe("live");
    expect(result.data).toEqual(["public-priya"]);
  });

  it("returns nothing when the backend omits the flag entirely", async () => {
    // The current state of mergefi-backend: no isProfilePublic field, so the
    // safe default applies and no profile is submitted for indexing.
    mockUsersResponse([
      { id: "1", username: "a" },
      { id: "2", username: "b" },
    ]);

    const result = await fetchIndexableReputationHandles(["fallback-handle"]);

    expect(result.data).toEqual([]);
  });

  it("drops entries with a blank username", async () => {
    mockUsersResponse([
      { id: "1", username: "", isProfilePublic: true },
      { id: "2", username: "real", isProfilePublic: true },
    ]);

    const result = await fetchIndexableReputationHandles([]);

    expect(result.data).toEqual(["real"]);
  });

  it("falls back to the caller's list when the backend is unreachable", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    const result = await fetchIndexableReputationHandles(["mock-handle"]);

    expect(result.source).toBe("mock");
    expect(result.data).toEqual(["mock-handle"]);
  });
});

describe("parseRetryAfter", () => {
  it("parses integer seconds correctly", () => {
    const { parseRetryAfter } = require("./api");
    expect(parseRetryAfter("120")).toBe(120);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("  45  ")).toBe(45);
    expect(parseRetryAfter("-10")).toBeUndefined();
    expect(parseRetryAfter("invalid")).toBeUndefined();
  });

  it("parses HTTP-date headers into remaining seconds", () => {
    const { parseRetryAfter } = require("./api");
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const seconds = parseRetryAfter(futureDate);
    expect(seconds).toBeGreaterThanOrEqual(58);
    expect(seconds).toBeLessThanOrEqual(61);
  });
});

describe("apiRequest rate limiting (429)", () => {
  const originalFetch = global.fetch;

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("formats 429 error message correctly with integer Retry-After", async () => {
    const { apiRequest, ApiRequestError } = require("./api");
    global.fetch = jest.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers({ "Retry-After": "30" }),
    }) as unknown as typeof fetch;

    await expect(apiRequest("/test-endpoint")).rejects.toThrow(ApiRequestError);
    await expect(apiRequest("/test-endpoint")).rejects.toThrow(
      "You're doing that too fast. Please wait 30 seconds before trying again.",
    );
  });

  it("formats 429 error message correctly without Retry-After header", async () => {
    const { apiRequest } = require("./api");
    global.fetch = jest.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers(),
    }) as unknown as typeof fetch;

    await expect(apiRequest("/test-endpoint-no-header")).rejects.toThrow(
      "You're doing that too fast.",
    );
  });
});

