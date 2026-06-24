/**
 * HTML sanitization for WordPress/WooCommerce content rendered with
 * dangerouslySetInnerHTML. Always run external HTML through this helper.
 */
import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "a", "b", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s",
  "small", "span", "strong", "sub", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "u", "ul",
];

const ALLOWED_ATTR = ["href", "title", "alt", "src", "target", "rel", "class", "width", "height"];

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    // Force safe link behaviour
    ADD_ATTR: ["target"],
  });
}

export function sanitizedHtmlProps(html: string | null | undefined) {
  return { dangerouslySetInnerHTML: { __html: sanitizeHtml(html) } };
}
