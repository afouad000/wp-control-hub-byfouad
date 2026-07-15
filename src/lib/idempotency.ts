/**
 * Idempotency wrapper.
 *
 * Caller supplies a stable `key` (e.g. `refund:<orderId>:<clientKey>`) plus
 * a compute function. On first invocation we record the result. On repeat
 * invocations within the retention window we return the cached response
 * instead of running the compute again — safe for refunds, bulk jobs,
 * provisioning, invitation acceptance.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export interface WithIdempotencyOptions<T> {
  supabase: Client;
  userId: string;
  key: string;
  compute: () => Promise<T>;
}

export async function withIdempotency<T>(opts: WithIdempotencyOptions<T>): Promise<T> {
  // Look up existing entry first — fast path for retries.
  const { data: existing, error: readErr } = await opts.supabase
    .from("idempotency_keys")
    .select("response, expires_at")
    .eq("user_id", opts.userId)
    .eq("key", opts.key)
    .maybeSingle();

  if (readErr) {
    console.warn("[idempotency] read failed, computing anyway", { key: opts.key, message: readErr.message });
  } else if (existing && new Date(existing.expires_at).getTime() > Date.now()) {
    return existing.response as T;
  }

  const result = await opts.compute();

  // Write-through. On unique-violation (concurrent request) prefer the winner.
  const { error: writeErr } = await opts.supabase
    .from("idempotency_keys")
    .upsert(
      {
        user_id: opts.userId,
        key: opts.key,
        response: (result ?? null) as unknown as Record<string, unknown>,
      },
      { onConflict: "user_id,key", ignoreDuplicates: false },
    );
  if (writeErr) {
    console.warn("[idempotency] write failed", { key: opts.key, message: writeErr.message });
  }
  return result;
}
