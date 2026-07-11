import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../../src/lib/sanitize";

describe("sanitizeHtml", () => {
  it("returns empty string for nullish input", () => {
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(undefined)).toBe("");
    expect(sanitizeHtml("")).toBe("");
  });

  it("preserves allowed WooCommerce markup", () => {
    const html = '<p>Hello <strong>world</strong></p><ul><li>one</li></ul>';
    const out = sanitizeHtml(html);
    expect(out).toContain("<p>");
    expect(out).toContain("<strong>");
    expect(out).toContain("<li>");
  });

  it("strips <script> tags and their contents", () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("strips <iframe>", () => {
    const out = sanitizeHtml('<iframe src="https://evil"></iframe>hi');
    expect(out.toLowerCase()).not.toContain("<iframe");
  });

  it("strips inline event handlers", () => {
    const out = sanitizeHtml('<a href="https://ok.example" onclick="alert(1)">x</a>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain("href");
  });

  it("strips javascript: URLs", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("keeps safe href on anchors", () => {
    const out = sanitizeHtml('<a href="https://good.example/page" title="t">x</a>');
    expect(out).toContain('href="https://good.example/page"');
  });

  it("keeps safe img src", () => {
    const out = sanitizeHtml('<img src="https://cdn.example/x.png" alt="p">');
    expect(out).toContain('<img');
    expect(out).toContain('https://cdn.example/x.png');
  });

  it("removes disallowed tags but keeps their text", () => {
    const out = sanitizeHtml('<marquee>go</marquee><object data="x"></object>');
    expect(out.toLowerCase()).not.toContain("<marquee");
    expect(out.toLowerCase()).not.toContain("<object");
    expect(out).toContain("go");
  });
});
