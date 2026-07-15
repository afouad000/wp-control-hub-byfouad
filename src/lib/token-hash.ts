/**
 * SHA-256 of a token, hex-encoded. Uses Web Crypto so it runs identically
 * on Cloudflare Workers, Node, and browsers.
 *
 * We only hash tokens server-side today, but keep it universal so tests can
 * run under Vitest without importing node:crypto.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}
