// Post-processing linkifiers for the three end-of-volume indexes. Each runs on
// the already-rendered *web* HTML of an index section (the faithful Version livre
// is left untouched), turning printed references into live links back into the
// edition — the same "rewrite the reading view" pattern as linkCrossRefs/
// linkBackrefs in render.js.
//
//   Index des mots / Index des N.W.  ->  "ROMAN, verse[, verse…]"  (chanson + line)
//                                        resolve via ctx.romanToNum -> /chansons/N/#vK
//   Index des œuvres et auteurs      ->  bare printed page numbers
//                                        resolve via ctx.printedToPage + pageToSection
//
// We never parse a grammar: we linkify only what unambiguously reads as a
// reference and leave glosses, `passim`, `(14 x)`, OCR noise, etc. as text.

// up to 8 chars: the longest chanson numeral is "XXXVIII" (38), which is 7
const ROMAN = "[IVXLC]{1,8}";

// "ROMAN , payload" where payload is a verse list (1, 8, 15), a `passim`
// (possibly italicised by markdown), or a parenthetical count like "(14 x)".
// Groups: 1 = roman, 2 = the comma+spaces separator, 3 = payload.
const WORD_REF = new RegExp(
  `\\b(${ROMAN})(\\s*,\\s*)` +
  `(\\d+(?:\\s*,\\s*\\d+)*|(?:<em>)?passim(?:<\\/em>)?|\\([^)]*\\))`, "g");

// A printed page number: a 1–3 digit run that is NOT the tail of a hyphenated
// range ("391-2", "319-330" -> link only the first endpoint) and not part of a
// longer number.
const PAGE_REF = /(?<![\d\-–])(\d{1,3})(?!\d)/g;

// Apply `fn` (a String.replace callback set) only to the text between HTML tags,
// so numeric substrings inside attributes (e.g. href="…#bib-12") are never touched.
function replaceTextOnly(html, re, fn) {
  return html
    .split(/(<[^>]*>)/)
    .map((chunk) => (chunk.startsWith("<") ? chunk : chunk.replace(re, fn)))
    .join("");
}

// ---- Index des mots / Index des N.W. --------------------------------------
// opts.cls: class on the verse links; opts.chCls: class on the chanson (roman)
// link (defaults to cls); opts.flags: optional collector for unknown romans.
// Used for the author-index web view (visible idx-ref classes) AND the word-index
// facsimile references (invisible fx-ilink class).
export function linkWordIndex(html, ctx, opts = {}) {
  const { romanToNum } = ctx;
  if (!romanToNum) return html;
  const cls = opts.cls || "idx-ref idx-v";
  const chCls = opts.chCls || cls;
  const flags = opts.flags;
  // roman+digit patterns never occur inside a tag in this content, so passim
  // (which may span <em>…</em>) is matched against the whole string.
  return html.replace(WORD_REF, (whole, roman, sep, payload) => {
    const num = romanToNum[roman];
    if (!num) {
      if (flags) flags.push({ type: "roman", roman, context: whole.replace(/<[^>]*>/g, "") });
      return whole;
    }
    const base = `/chansons/${num}/`;
    const romanLink = `<a class="${chCls}" href="${base}">${roman}</a>`;
    if (/^\d/.test(payload)) {
      const linked = payload.replace(/\d+/g, (n) => `<a class="${cls}" href="${base}#v${n}">${n}</a>`);
      return romanLink + sep + linked;
    }
    // `passim` / `(14 x)` — link the chanson, keep the payload verbatim
    return romanLink + sep + payload;
  });
}

// ---- Index des œuvres et des auteurs occitans cités -----------------------
export function linkAuthorIndex(html, ctx, opts = {}) {
  const { printedToPage, pageToSection } = ctx;
  if (!printedToPage || !pageToSection) return html;
  const cls = opts.cls || "idx-ref idx-page";
  const flags = opts.flags;
  return replaceTextOnly(html, PAGE_REF, (m, n) => {
    const pid = printedToPage.get(n);
    const slug = pid && pageToSection.get(pid);
    if (!slug) {
      if (flags) flags.push({ type: "page", page: n });
      return m;
    }
    return `<a class="${cls}" href="/${slug}/#page-${pid}">${n}</a>`;
  });
}

// Dispatch by section slug; returns the linkified web HTML (or the input, for a
// slug we don't linkify). `flags` collects unresolved references for reporting.
export function linkIndexSection(html, slug, ctx, flags) {
  if (slug === "index-mots" || slug === "index-nw")
    return linkWordIndex(html, ctx, { cls: "idx-ref idx-v", chCls: "idx-ref idx-ch", flags });
  if (slug === "index-oeuvres")
    return linkAuthorIndex(html, ctx, { cls: "idx-ref idx-page", flags });
  return html;
}

// ---------------------------------------------------------------------------
// Facsimile layout helpers — the typescript set each word-index entry on its
// own line in two columns (lemma | reference at a fixed tab), and hung each
// author entry's wrapped page list under its first page number. book.md long
// ago reflowed the word entries onto run-on lines (" — "-separated), so we
// re-derive that structure here for the faithful facsimile view only.

// Split a run-on word-index line into its entries, respecting parentheses (a
// gloss like "COR (Aver — que)" carries its own em dash) and numeric ranges
// ("TOLRE IV, 39 — 42": the "— 42" is a verse range, not a new entry — detected
// by the digit that follows the dash).
function splitEntries(text) {
  const out = [];
  let depth = 0, buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "—" && depth === 0) {
      let j = i + 1;
      while (j < text.length && text[j] === " ") j++;
      if (/\d/.test(text[j] || "")) { buf += c; continue; } // range, keep inline
      out.push(buf); buf = "";
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

// Within one entry, the reference begins at the first roman numeral + comma at
// paren-depth 0 (e.g. "AMAIRE (se metre) XXV, 5" -> lemma "AMAIRE (se metre)",
// ref "XXV, 5"). Everything before it is the lemma (possibly with a gloss).
function splitLemmaRef(entry) {
  let depth = 0;
  for (let i = 0; i < entry.length; i++) {
    const c = entry[i];
    if (c === "(") { depth++; continue; }
    if (c === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0) continue;
    const prev = entry[i - 1];
    if ((prev === undefined || !/[A-Za-z]/.test(prev)) && /^[IVXLC]{1,8}\s*,/.test(entry.slice(i)))
      return { lemma: entry.slice(0, i).trim(), ref: entry.slice(i).trim() };
  }
  return { lemma: entry.trim(), ref: "" };
}

export function splitWordEntries(lineBody) {
  return splitEntries(lineBody).map(splitLemmaRef).filter((e) => e.lemma);
}

// Column at which an author entry's continuation lines hang: the visible width
// (markdown stripped) of "Name : " up to and including the space after the colon.
// The name/refs separator is French-typography " : " (narrow no-break space
// before the colon), so key on the colon itself, not a plain " : ".
export function authorIndent(line) {
  const idx = line.indexOf(":");
  if (idx < 0) return 0;
  const after = line.charCodeAt(idx + 1);
  // regular space (0x20), NBSP (0xA0) or narrow NBSP (0x202F) after the colon
  const end = idx + (after === 0x20 || after === 0xa0 || after === 0x202f ? 2 : 1);
  return line.slice(0, end)
    .replace(/[*_`]/g, "").replace(/[[\]]/g, "").replace(/\{[^}]*\}/g, "").length;
}
