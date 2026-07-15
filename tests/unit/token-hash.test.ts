import { describe, it, expect } from "vitest";
import { sha256Hex } from "../../src/lib/token-hash";

describe("sha256Hex", () => {
  it("matches a known vector", async () => {
    // sha256("hello") — well-known test vector.
    expect(await sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("is deterministic", async () => {
    const a = await sha256Hex("token-abc-123");
    const b = await sha256Hex("token-abc-123");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differs for tiny perturbations", async () => {
    const a = await sha256Hex("token-abc-123");
    const b = await sha256Hex("token-abc-124");
    expect(a).not.toBe(b);
  });
});
