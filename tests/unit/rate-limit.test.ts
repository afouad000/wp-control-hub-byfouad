import { describe, it, expect } from "vitest";
import { enforceRateLimit, RateLimitExceededError } from "../../src/lib/rate-limit";

/**
 * Minimal fake Supabase client that satisfies the interface used by
 * `enforceRateLimit`. It only supports the exact chain the helper builds.
 */
function makeFakeClient(rows: Array<{ user_id: string; key: string; created_at: string }>) {
  const inserted: Array<{ user_id: string; key: string }> = [];

  const chainable = (result: unknown) =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "then") return undefined;
          if (prop === "gte") return () => Promise.resolve(result);
          return () => chainable(result);
        },
      },
    );

  return {
    inserted,
    from(_table: string) {
      return {
        select: (_col: string, opts?: { count?: string; head?: boolean }) => {
          const count = opts?.count === "exact" ? rows.length : null;
          return chainable({ count, error: null });
        },
        insert: (row: { user_id: string; key: string }) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
        delete: () => chainable({ error: null }),
      };
    },
  };
}

describe("enforceRateLimit", () => {
  it("allows and records when under the limit", async () => {
    const client = makeFakeClient([]);
    await enforceRateLimit({
      supabase: client,
      userId: "u1",
      key: "test",
      max: 3,
      windowSeconds: 60,
    });
    expect(client.inserted).toHaveLength(1);
    expect(client.inserted[0]).toEqual({ user_id: "u1", key: "test" });
  });

  it("throws RateLimitExceededError at the limit", async () => {
    const client = makeFakeClient([
      { user_id: "u1", key: "test", created_at: new Date().toISOString() },
      { user_id: "u1", key: "test", created_at: new Date().toISOString() },
      { user_id: "u1", key: "test", created_at: new Date().toISOString() },
    ]);
    await expect(
      enforceRateLimit({
        supabase: client,
        userId: "u1",
        key: "test",
        max: 3,
        windowSeconds: 60,
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
    // No insert should have happened.
    expect(client.inserted).toHaveLength(0);
  });
});
