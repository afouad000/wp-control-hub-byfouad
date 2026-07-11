import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assertSafeUrl, safeFetch, SafeFetchAbortError } from "../../src/lib/safe-fetch";

describe("assertSafeUrl", () => {
  it("accepts a normal public https URL", () => {
    expect(() => assertSafeUrl("https://example.com/wp-json")).not.toThrow();
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => assertSafeUrl("ftp://example.com")).toThrow(SafeFetchAbortError);
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(SafeFetchAbortError);
    expect(() => assertSafeUrl("javascript:alert(1)")).toThrow(SafeFetchAbortError);
  });

  it("rejects garbage input as invalid_url", () => {
    try {
      assertSafeUrl("not-a-url");
    } catch (e) {
      expect(e).toBeInstanceOf(SafeFetchAbortError);
      expect((e as SafeFetchAbortError).info.kind).toBe("invalid_url");
      return;
    }
    throw new Error("expected throw");
  });

  it.each([
    ["http://localhost/x"],
    ["http://LOCALHOST/x"],
    ["http://foo.local"],
    ["http://api.internal"],
    ["http://box.lan"],
    ["http://metadata.google.internal/"],
  ])("rejects internal hostname %s", (url) => {
    expect(() => assertSafeUrl(url)).toThrow(/local|internal|private|reserved/i);
  });

  it.each([
    ["http://127.0.0.1/"],
    ["http://10.0.0.5/"],
    ["http://172.16.0.1/"],
    ["http://192.168.1.1/"],
    ["http://169.254.169.254/latest/meta-data/"], // AWS metadata
    ["http://100.64.0.1/"], // CGNAT
    ["http://0.0.0.0/"],
    ["http://255.255.255.255/"],
  ])("rejects blocked IPv4 %s", (url) => {
    expect(() => assertSafeUrl(url)).toThrow(SafeFetchAbortError);
  });

  it.each([
    ["http://[::1]/"],
    ["http://[fe80::1]/"],
    ["http://[fc00::1]/"],
    ["http://[::ffff:127.0.0.1]/"],
  ])("rejects blocked IPv6 %s", (url) => {
    expect(() => assertSafeUrl(url)).toThrow(SafeFetchAbortError);
  });

  it("accepts a normal public IPv4", () => {
    expect(() => assertSafeUrl("http://8.8.8.8/")).not.toThrow();
  });
});

describe("safeFetch", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    // reset
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("re-validates redirect targets and blocks a bounce to internal", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.startsWith("https://public.example.com")) {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } });
      }
      return new Response("nope", { status: 200 });
    }) as unknown as typeof fetch;

    await expect(safeFetch("https://public.example.com/redirect")).rejects.toMatchObject({
      info: { kind: "blocked_host" },
    });
  });

  it("returns response on 2xx", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const res = await safeFetch("https://example.com/x");
    expect(res.status).toBe(200);
  });

  it("times out via AbortController", async () => {
    globalThis.fetch = vi.fn((_: unknown, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    await expect(safeFetch("https://example.com/slow", { timeoutMs: 20 })).rejects.toMatchObject({
      info: { kind: "timeout" },
    });
  });

  it("stops after maxRedirects", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n++;
      return new Response(null, { status: 302, headers: { location: `https://public${n}.example.com/` } });
    }) as unknown as typeof fetch;

    await expect(safeFetch("https://public.example.com/", { maxRedirects: 2 })).rejects.toMatchObject({
      info: { kind: "too_many_redirects" },
    });
  });
});
