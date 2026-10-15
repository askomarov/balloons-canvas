const DEFAULT_WORD = "Happy";
const MAX_CHARS = 50;

export function wordFromQuery() {
  const raw = new URLSearchParams(location.search).get("word");
  if (!raw) return DEFAULT_WORD;

  const cleaned = raw
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, MAX_CHARS);

  const text = cleaned.split("_").filter(Boolean).join("|");
  return text || DEFAULT_WORD;
}
