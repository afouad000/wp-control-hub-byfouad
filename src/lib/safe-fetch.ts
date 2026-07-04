/**
 * SSRF-hardened outbound HTTP client for server functions.
 *
 * Every call to a user-supplied URL (WordPress / WooCommerce site) MUST go
 * through `safeFetch` — never call `fetch` directly with `${site.url}/...`.
 *
 * Protections:
 *  - Only http:/https: schemes are allowed.
 *  - Hostnames that are IP literals are rejected if they fall in
 *    loopback / private / link-local / CGNAT / multicast / metadata ranges.
 *  - Hostnames that look internal (`localhost`, `*.local`, `*.internal`,
 *    `*.lan`, cloud metadata names) are rejected.
 *  - Requests carry a hard timeout via AbortController (default 15s).
 *  - Redirects are followed manually (max 3 hops); every hop is
 *    re-validated so a public origin cannot bounce us to an internal one.
 *
 * DNS-level resolution is intentionally not performed here: the Cloudflare
 * Worker runtime this app deploys to does not expose Node's `dns` module in
 * a way we can rely on. Blocking IP literals + suspicious names catches the
 * common SSRF payloads; combined with an outbound egress that already
 * cannot reach cloud-internal networks this is a reasonable defence.
 */

// Server-only: keep this out of browser bundles.

export type SafeFetchError = {
  kind:
    | "invalid_url"
    | "blocked_host"
    | "blocked_scheme"
    | "timeout"
    | "too_many_redirects"
    | "network";
  message: string;
};

export class SafeFetchAbortError extends Error {
  constructor(public info: SafeFetchError) {
    super(info.message);
    this.name = "SafeFetchAbortError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
  // Cloud metadata service names
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "instance-data.ec2.internal",
]);

const BLOCKED_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".intranet",
  ".corp",
  ".home",
  ".home.arpa",
  ".localdomain",
];

/** IPv4 dotted-quad → 32-bit integer, or null if not a valid IPv4. */
function ipv4ToInt(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

const IPV4_BLOCKED_RANGES: Array<[number, number]> = [
  // 0.0.0.0/8   "this network"
  [0x00000000, 0x00ffffff],
  // 10.0.0.0/8  private
  [0x0a000000, 0x0affffff],
  // 100.64.0.0/10 CGNAT
  [0x64400000, 0x647fffff],
  // 127.0.0.0/8 loopback
  [0x7f000000, 0x7fffffff],
  // 169.254.0.0/16 link-local + AWS/GCP metadata (169.254.169.254)
  [0xa9fe0000, 0xa9feffff],
  // 172.16.0.0/12 private
  [0xac100000, 0xac1fffff],
  // 192.0.0.0/24 IETF protocol assignments
  [0xc0000000, 0xc00000ff],
  // 192.0.2.0/24 TEST-NET-1
  [0xc0000200, 0xc00002ff],
  // 192.168.0.0/16 private
  [0xc0a80000, 0xc0a8ffff],
  // 198.18.0.0/15 benchmarking
  [0xc6120000, 0xc613ffff],
  // 198.51.100.0/24 TEST-NET-2
  [0xc6336400, 0xc63364ff],
  // 203.0.113.0/24 TEST-NET-3
  [0xcb007100, 0xcb0071ff],
  // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255 broadcast
  [0xe0000000, 0xffffffff],
];

function isBlockedIPv4(int32: number): boolean {
  return IPV4_BLOCKED_RANGES.some(([lo, hi]) => int32 >= lo && int32 <= hi);
}

function isBlockedIPv6(host: string): boolean {
  // Strip brackets if URL-style [::1]
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  // Loopback
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  // Unspecified
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return true;
  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;
  // Unique local fc00::/7
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  // Multicast ff00::/8
  if (/^ff[0-9a-f]{2}:/.test(h)) return true;
  // IPv4-mapped ::ffff:127.0.0.1 → check embedded v4
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
  if (mapped) {
    const v4 = ipv4ToInt(mapped[1]);
    return v4 !== null && isBlockedIPv4(v4);
  }
  return false;
}

/**
 * Validate a URL for outbound fetch. Returns the normalized URL or throws
 * `SafeFetchAbortError` with a stable `kind`.
 */
export function assertSafeUrl(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SafeFetchAbortError({ kind: "invalid_url", message: "That doesn't look like a valid URL." });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SafeFetchAbortError({
      kind: "blocked_scheme",
      message: `Only http:// and https:// URLs are allowed (got ${u.protocol}).`,
    });
  }
  const host = u.hostname.toLowerCase();
  if (!host) {
    throw new SafeFetchAbortError({ kind: "invalid_url", message: "URL is missing a hostname." });
  }
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SafeFetchAbortError({
      kind: "blocked_host",
      message: "This hostname points to a local or internal address and can't be used.",
    });
  }
  if (BLOCKED_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s))) {
    throw new SafeFetchAbortError({
      kind: "blocked_host",
      message: "Internal / private hostnames (.local, .internal, .lan, etc.) can't be used.",
    });
  }
  const v4 = ipv4ToInt(host);
  if (v4 !== null && isBlockedIPv4(v4)) {
    throw new SafeFetchAbortError({
      kind: "blocked_host",
      message: "That IP address is on a private, loopback, or reserved range.",
    });
  }
  if (isBlockedIPv6(host)) {
    throw new SafeFetchAbortError({
      kind: "blocked_host",
      message: "That IPv6 address is on a private, loopback, or reserved range.",
    });
  }
  return u;
}

export type SafeFetchOptions = RequestInit & {
  /** Hard timeout in ms. Default 15000. */
  timeoutMs?: number;
  /** Max redirects to follow. Default 3. Each hop is re-validated. */
  maxRedirects?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;

/**
 * `fetch` wrapper that validates the URL, enforces a timeout, and follows
 * redirects manually — re-validating each hop against the SSRF blocklist.
 *
 * Throws `SafeFetchAbortError` for validation/timeout/redirect failures.
 * Network errors are re-thrown as `SafeFetchAbortError` with `kind: "network"`.
 * A successful HTTP response (even 4xx/5xx) is returned; callers handle status.
 */
export async function safeFetch(input: string | URL, init: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = DEFAULT_MAX_REDIRECTS, ...rest } = init;
  let currentUrl = assertSafeUrl(typeof input === "string" ? input : input.toString()).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Chain any caller-provided signal so their cancellation still works.
  if (rest.signal) {
    const s = rest.signal;
    if (s.aborted) controller.abort();
    else s.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let res: Response;
      try {
        res = await fetch(currentUrl, { ...rest, redirect: "manual", signal: controller.signal });
      } catch (e) {
        if (controller.signal.aborted) {
          throw new SafeFetchAbortError({ kind: "timeout", message: `Request timed out after ${timeoutMs}ms.` });
        }
        throw new SafeFetchAbortError({
          kind: "network",
          message: e instanceof Error ? e.message : "Network error contacting the site.",
        });
      }
      // Manual redirect handling
      if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
        if (hop === maxRedirects) {
          throw new SafeFetchAbortError({
            kind: "too_many_redirects",
            message: `Site issued more than ${maxRedirects} redirects.`,
          });
        }
        const nextUrl = new URL(res.headers.get("location")!, currentUrl).toString();
        assertSafeUrl(nextUrl); // re-validate every hop
        currentUrl = nextUrl;
        continue;
      }
      return res;
    }
    // Unreachable — loop always returns or throws.
    throw new SafeFetchAbortError({ kind: "too_many_redirects", message: "Redirect loop." });
  } finally {
    clearTimeout(timer);
  }
}

/** Convert a SafeFetch error into a short user-facing message. */
export function safeFetchErrorMessage(err: unknown, fallback = "Could not reach the site."): string {
  if (err instanceof SafeFetchAbortError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}
