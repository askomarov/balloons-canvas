const DEFAULT_WORD = "Happy";
const MAX_CHARS = 50;
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
// L/N letters+digits, P punctuation, S symbols (emoji etc), M combining marks;
// ZWJ + VS16 keep multi-codepoint emoji intact. `|` reserved as our linebreak.
const ALLOWED = /[^\p{L}\p{N}\p{P}\p{S}\p{M}_\-\u200d\ufe0f]/gu;

const segmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function truncateGraphemes(str, max) {
  if (!segmenter) return [...str].slice(0, max).join("");

  let out = "";
  let n = 0;
  for (const { segment } of segmenter.segment(str)) {
    if (n >= max) break;
    out += segment;
    n++;
  }
  return out;
}

export function wordFromQuery() {
  const raw = new URLSearchParams(location.search).get("word");
  if (!raw) return DEFAULT_WORD;

  const cleaned = truncateGraphemes(
    raw.replace(/\|/g, "").replace(ALLOWED, ""),
    MAX_CHARS,
  );

  const text = cleaned.split("_").filter(Boolean).join("|");
  return text || DEFAULT_WORD;
}

/** @returns {string | null} `#rrggbb` or null if missing/invalid */
export function hexFromQuery() {
  const raw = new URLSearchParams(location.search).get("hex");
  if (!raw) return null;

  const match = raw.trim().match(HEX_RE);
  if (!match) return null;

  let h = match[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return `#${h.toLowerCase()}`;
}
