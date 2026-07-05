// Join the terse per-chanson "Manuscrits" shorthand (bibliography.json
// par_chanson[].manuscrits, e.g. "D : Est.,91. I : MG,626. K : — a : RLR…") to
// the curated witness identities in manuscripts.json, producing a structured,
// legible list: each witness siglum carries its full shelfmark and the printed
// diplomatic-edition locus. Sigla that don't map to a catalogued witness (OCR
// artifacts, α, lowercase/prime variants of no listed manuscript) are left as
// printed and reported for manual review — never guessed.

// witness-identity index: manuscripts.json siglum -> { siglum, ident, href }.
export function buildMsIdentityIndex(manuscriptRaw) {
  const idx = new Map();
  for (const w of (manuscriptRaw && manuscriptRaw.witnesses) || []) {
    const ident = (w.location || w.description || "").replace(/\.\s*$/, "").trim();
    const rec = { siglum: w.siglum, ident, href: "/manuscrits/#" + encodeURIComponent(w.siglum) };
    idx.set(w.siglum, rec);
    // the Greek witnesses are cited by their symbol, not the ASCII key.
    if (w.label === "β" || w.label === "ψ") idx.set(w.label, rec);
  }
  return idx;
}

// One witness token in the shorthand: an optionally underlined / starred letter,
// with an optional ^superscript^, an optional trailing digit and prime. Greek
// α/β/ψ included. Two-letter underline forms cover "[N2]" and the like.
const SIGT =
  "(?:\\[[A-Za-zαβψ][A-Za-z]?[0-9]?\\]\\{\\.underline\\}|\\*?[A-Za-zαβψ]\\*?(?:\\^[A-Za-z0-9]+\\^)?\\*?[0-9]?'?)";
// a siglum GROUP is one or more tokens (space-separated) directly before a colon
// — several manuscripts can share one diplomatic edition ("C D^a^ I K N N² : …").
const GROUP = new RegExp("((?:" + SIGT + "\\s+)*" + SIGT + ")\\s*:", "g");

function cleanToken(t) {
  t = t.trim();
  const u = t.match(/^\[([^\]]+)\]\{\.underline\}$/);
  if (u) t = u[1];
  return t.replace(/\*/g, "").trim();
}

// display HTML for a token: ^x^ -> <sup>x</sup>, underline/star markup stripped.
function tokenHtml(t) {
  return cleanToken(t).replace(/\^([A-Za-z0-9]+)\^/g, "<sup>$1</sup>");
}

// map a token to a manuscripts.json key: its base letter, or the base+"2" variant
// (N² -> N2) when that witness exists. Case-sensitive (a ≠ A, per Pillet-Carstens).
// Returns null when nothing matches — the caller flags it.
function baseKey(tok, idx) {
  const t = cleanToken(tok);
  if (t && "αβψ".includes(t[0])) return idx.has(t[0]) ? t[0] : null;
  const m = t.match(/^([A-Za-z])/);
  if (!m) return null;
  const base = m[1];
  const has2 = /\^2\^/.test(t) || /2'?$/.test(t);
  if (has2 && idx.has(base + "2")) return base + "2";
  return idx.has(base) ? base : null;
}

const EMPTY_LOCUS = new Set(["", "-", "–", "—"]);

// Parse one chanson's manuscrits blob. Returns { groups, flags } where a group is
// { sigla: [{ html, href|null, ident|null }], locus: "" }, and flags lists the
// cleaned tokens that didn't resolve to a catalogued witness.
export function parseChansonManuscrits(blob, idx) {
  const s = String(blob || "").replace(/[  ]/g, " ");
  const marks = [...s.matchAll(GROUP)];
  const groups = [];
  const flags = [];
  marks.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : s.length;
    let locus = s.slice(start, end).trim().replace(/^\.\s*/, "").replace(/\s*\.\s*$/, "").trim();
    if (EMPTY_LOCUS.has(locus)) locus = "";
    const sigla = m[1].trim().split(/\s+/).map((tok) => {
      const key = baseKey(tok, idx);
      if (!key) flags.push(cleanToken(tok));
      const rec = key ? idx.get(key) : null;
      return { html: tokenHtml(tok), href: rec ? rec.href : null, ident: rec ? rec.ident : null };
    });
    groups.push({ sigla, locus });
  });
  return { groups, flags };
}
