import sanitizeHtml from "sanitize-html";

const allowedTags = [
  "p",
  "br",
  "div",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "blockquote",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "hr",
  "a",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
];

export function sanitizeEmailHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      }),
    },
  });
}

export function emailPreview(bodyText?: string | null, bodyHtml?: string | null) {
  const source = bodyText?.trim()
    ? bodyText
    : sanitizeHtml(bodyHtml ?? "", { allowedTags: [], allowedAttributes: {} });
  return source.replace(/\s+/g, " ").trim().slice(0, 180);
}
