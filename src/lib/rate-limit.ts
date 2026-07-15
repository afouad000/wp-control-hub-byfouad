/**
 * Ad-hoc per-user rate limiting.
 *
 * The Lovable backend has no first-class rate-limiter primitive, so we keep
 * a small `public.rate_limit_events` audit table and count recent rows per
 * (user, key) inside sensitive server functions.
 *
 * This is best-effort: it protects against accidental floods and casual
 * abuse. It is not a replacement for edge-level DDoS protection. Old rows
 * are cleaned up opportunistically on write.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export class RateLimitExceededError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface RateLimitOptions {
  supabase: Client;
  userId: string;
  key: string;
  max: number;
  windowSeconds: number;
}

/**
 * Throws RateLimitExceededError if the caller has exceeded `max` events with
 * `key` in the last `windowSeconds`. Otherwise records the event and returns.
 */
export async function enforceRateLimit(opts: RateLimitOptions): Promise<void> {
  const since = new Date(Date.now() - opts.windowSeconds * 1000).toISOString();

  const { count, error } = await opts.supabase
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", opts.userId)
    .eq("key", opts.key)
    .gte("created_at", since);

  if (error) {
    // Fail open on transient DB errors — we don't want the limiter to be a
    // permanent outage vector. Log server-side for ops.
    console.warn("[rate-limit] count failed, allowing", { key: opts.key, message: error.message });
    return;
  }

  if ((count ?? 0) >= opts.max) {
    throw new RateLimitExceededError(
      `Too many attempts. Please wait ${opts.windowSeconds} seconds and try again.`,
      opts.windowSeconds,
    );
  }

  const { error: insErr } = await opts.supabase
    .from("rate_limit_events")
    .insert({ user_id: opts.userId, key: opts.key });
  if (insErr) {
    console.warn("[rate-limit] insert failed", { key: opts.key, message: insErr.message });
  }

  // Opportunistic cleanup: 1% of writes.
  if (Math.random() < 0.01) {
    const oldCutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    await opts.supabase.from("rate_limit_events").delete().eq("user_id", opts.userId).lt("created_at", oldCutoff);
  }
}
