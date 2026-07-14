import { describe, it, expect } from "vitest";
import { generateInvitationToken, isInvitationLive } from "../../src/lib/invitations.functions";

describe("generateInvitationToken", () => {
  it("returns a URL-safe base64 string of adequate length", () => {
    const t = generateInvitationToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it("is unique across calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateInvitationToken());
    expect(set.size).toBe(100);
  });
});

describe("isInvitationLive", () => {
  const inFuture = new Date(Date.now() + 60_000).toISOString();
  const inPast = new Date(Date.now() - 60_000).toISOString();

  it("live when not accepted, not revoked, not expired", () => {
    expect(isInvitationLive({ expires_at: inFuture, accepted_at: null, revoked_at: null })).toBe(true);
  });
  it("dead when accepted", () => {
    expect(isInvitationLive({ expires_at: inFuture, accepted_at: inPast, revoked_at: null })).toBe(false);
  });
  it("dead when revoked", () => {
    expect(isInvitationLive({ expires_at: inFuture, accepted_at: null, revoked_at: inPast })).toBe(false);
  });
  it("dead when expired", () => {
    expect(isInvitationLive({ expires_at: inPast, accepted_at: null, revoked_at: null })).toBe(false);
  });
});
