/**
 * Server-only environment validation.
 *
 * Server functions call `requireServerEnv()` to fail fast with a readable
 * message if a required variable is missing, instead of getting an opaque
 * downstream error. Read process.env inside functions — Cloudflare Workers
 * inject env per request, so module-scope reads may be undefined.
 */

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export type RequiredEnvName = (typeof REQUIRED)[number];

export function requireServerEnv(name: RequiredEnvName): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Server misconfiguration: required environment variable ${name} is not set.`,
    );
  }
  return v;
}

/** Optional envs — return undefined instead of throwing. */
export function optionalServerEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

/** Assert every required env is present. Call at the top of a handler. */
export function assertRequiredEnv(): void {
  const missing: string[] = [];
  for (const name of REQUIRED) {
    const v = process.env[name];
    if (!v || v.trim() === "") missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `Server misconfiguration: missing environment variables: ${missing.join(", ")}.`,
    );
  }
}
