const DEFAULT_WORD = "Happy";
const MAX_CHARS = 50;
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function wordFromQuery() {
  const raw = new URLSearchParams(location.search).get("word");
  if (!raw) return DEFAULT_WORD;

  const cleaned = raw
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, MAX_CHARS);

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
