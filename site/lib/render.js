// Markdown -> HTML renderer for the Raimbaut edition.
//
// The corpus is Pandoc-flavoured Markdown, so plain markdown-it is not enough.
// We handle, in order:
//   1. Pandoc fenced divs  ::: {.verse lang=oc} … :::   -> <div class=…> with
//      verse lines preserved (white-space:pre-wrap so hemistich gaps + line
//      breaks survive while *italics*/·interpuncts still render).
//   2. Footnotes  [^label] / [^label]: …  -> Tufte margin sidenotes (numbered by
//      CSS counter). Definitions are resolved from a GLOBAL map so a ref and its
//      def landing in adjacent page-sections still reconnect.
//   3. Inline spans  [RO]{.underline} / [mot]{lang=oc}  via bracketed-spans+attrs.
//   4. Siglum linking: an underlined token that is a known abbreviation becomes a
//      link into /abbreviations/ with the full definition as a tooltip.
//   5. <!-- page: PID --> anchors are kept as invisible provenance markers.
import MarkdownIt from "markdown-it";
import attrs from "markdown-it-attrs";
import bracketedSpans from "markdown-it-bracketed-spans";
import { splitWordEntries, authorIndent, linkWordIndex, linkAuthorIndex } from "./indexes.js";

export function makeMd() {
  // typographer gives smart quotes/apostrophes ("liège" -> "liège", s'espan ->
  // s'espan). French guillemets are already literal in the corpus, so straight
  // quotes get English curly quotes. 'replacements' is disabled: it rewrites
  // (c)/(tm)/-- and could corrupt scholarly text.
  const md = new MarkdownIt({
    html: true, typographer: true, breaks: false,
    quotes: ["“", "”", "‘", "’"],
  });
  md.disable("replacements");
  md.use(bracketedSpans);
  md.use(attrs, { allowedAttributes: [] }); // allow all (class, lang, …)
  // Pandoc superscripts: XII^e^, 1^re^, V^III^, f°146^v^ -> <sup>…</sup>.
  // Content excludes [ ] so footnote refs [^label] (single caret) never match.
  const sup = (s) => s.replace(/\^([^\s^\[\]]{1,20})\^/g, "<sup>$1</sup>");
  const _render = md.render.bind(md);
  const _inline = md.renderInline.bind(md);
  md.render = (s, env) => _render(sup(s), env);
  md.renderInline = (s, env) => _inline(sup(s), env);
  return md;
}

const FN_DEF = /^\[\^([^\]]+)\]:\s?(.*)$/;
const FN_REF = /\[\^([^\]]+)\]/g;
const DIV_OPEN = /^\s*:::+\s*\{([^}]*)\}\s*$/;   // tolerate leading indent (gpt-4o sometimes indents fences)
const DIV_CLOSE = /^\s*:::+\s*$/;
const PAGE_ANCHOR = /^<!--\s*page:\s*([^\s]+)\s*-->$/;

// Parse a Pandoc attr string like ".verse lang=oc" or ".unclear"
function parseAttrs(s) {
  const cls = [];
  const attr = {};
  for (const tok of s.trim().split(/\s+/)) {
    if (!tok) continue;
    if (tok.startsWith(".")) cls.push(tok.slice(1));
    else {
      const eq = tok.indexOf("=");
      if (eq > 0) attr[tok.slice(0, eq)] = tok.slice(eq + 1).replace(/^["']|["']$/g, "");
    }
  }
  return { cls, attr };
}

// Collect [^label]: definitions from the whole book -> { label: markdown }
export function collectFootnoteDefs(markdown) {
  const defs = {};
  for (const line of markdown.split("\n")) {
    const m = line.match(FN_DEF);
    if (m) defs[m[1]] = m[2];
  }
  return defs;
}

// Build a siglum lookup { TOKEN: {siglum, definition, href, short} } from
// citations.json. `short` is a compact expansion ("Pattison, Life and Works…")
// shown inline after the siglum's first occurrence in a note.
// nobiliary particles + Catalan/Portuguese connectors: kept lowercase when a
// surname is title-cased, and absorbed into a name run ("DE BRUYNE" -> "de
// Bruyne", "AGULIO I FUSTER" -> "Agulio i Fuster").
const PARTICLES = new Set([
  "von", "van", "de", "del", "della", "dei", "dal", "du", "la", "le", "der",
  "den", "dos", "das", "i", "y", "e",
]);
function titleCaseName(s) {
  const cap = (w) => w.split(/([-'’])/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return String(s || "").toLowerCase().split(/\s+/).map((w) =>
    PARTICLES.has(w) ? w : cap(w)).join(" ");
}

// -------------------------------------------------------- author small caps
// Author surnames sit in the typescript as full caps (JEANROY, DE BRUYNE). We
// render them as real small caps (<span class="sc"> + title-case, so the smcp
// feature keeps the initial as a full cap: "Jᴇᴀɴʀᴏʏ"). To avoid catching Roman
// numerals (XII) and sigla (FEW, PDL), we only wrap runs that hit a surname in
// a curated set harvested from the bibliography/citations (collectAuthorSurnames).
const UC = "A-ZÀ-ÖØ-Þ";                              // uppercase Latin + accents
const LC = "a-zà-öø-ÿ";                              // lowercase Latin + accents
const IS_UC_WORD = new RegExp(`^[${UC}][${UC}'’.\\-]*$`);
const ROMAN = /^[IVXLCDM]+$/;
const normWord = (w) => w.replace(/^[.'’\-]+|[.'’\-]+$/g, "");

// A word token in rendered text (words carry their own dots/apostrophes/hyphens).
const WORD_RE = new RegExp(`[${UC}${LC}0-9][${UC}${LC}0-9'’.\\-]*`, "g");
// A surname candidate: all-caps, hyphen-joinable, NO interior period (initials
// have been split off first). Length is checked separately on the letter core.
const IS_SURNAME = new RegExp(`^[${UC}][${UC}'’]*(?:-[${UC}][${UC}'’]*)*$`);
// A name signal that precedes a surname: an initial ("A.", "C.T.", "G.B.") or a
// given name ("Luigi", "Jean-Marie", abbreviated "Ch.") — either marks the next
// all-caps word as a personal surname even when it isn't in the curated set. The
// initial MUST carry a period, else a lone Roman numeral ("CHANSON I : …") would
// masquerade as one. A leading elision ("d'Yves", "l'Auteur") is stripped first.
const IS_INITIAL = new RegExp(`^[${UC}](?:\\.[${UC}])*\\.$`);
// honorifics that flag a following all-caps word as a personal surname even
// with no initial ("MM. d'AGUILAR et d'ESCOULOUBRE"). "M." already matches
// IS_INITIAL; the plural "MM." and the feminine forms do not.
const HONORIFIC = new Set(["MM.", "Mme", "Mme.", "Mlle", "Mlle.", "Mgr", "Dr", "Pr"]);
const IS_FIRST = new RegExp(`^[${UC}][${LC}]+(?:-[${UC}]?[${LC}]+)*\\.?$`);
const ELISION = new RegExp(`^[${LC}]['’]`);
// initials glued to a surname by a period ("E.HOEPFFNER", "G.B.PELLEGRINI") —
// re-separated with a space so the surname stands alone and the initials stay caps.
const GLUED_INITIALS = new RegExp(`([${UC}](?:\\.[${UC}])*\\.)([${UC}][${UC}'’-]{2,})`, "g");
// initials glued to a TITLE-CASE surname ("C.Appel", "W.T.Pattison", "M.Chambers").
// Only the first letter of the name is captured + re-emitted, so the rest stays
// attached: "W.T.Pattison" -> "W.T. Pattison". Roman numerals ("XII.La") never
// match, since the initials group needs a period between each capital.
const GLUED_INIT_TC = new RegExp(`([${UC}](?:\\.[${UC}])*\\.)([${UC}][${LC}])`, "g");
// trailing punctuation kept outside the small-caps span
const NAME_TAIL = /[.,;:!?)\]»”"'’]+$/;
const nameCore = (w) => w.replace(NAME_TAIL, "");

// Build the surname set from the apparatus JSONs. Each author field ("AUERBACH",
// "Alfred JEANROY", "DE BRUYNE") contributes its all-caps words, minus particles,
// Roman numerals and anything shorter than 3 letters. Siglum codes are removed so
// a code that happens to look like a name (rare) is never small-capped.
// a bibliographic "SURNAME, Initial" run — an all-caps word (no interior period)
// followed by a comma and a capital. High precision: neither Roman numerals nor
// sigla are written with a following given-name initial ("LUCAS, H.H.", but not
// "RO, dans" / "LXXI, 1951").
const CITED_NAME = new RegExp(`\\b([${UC}][${UC}'’\\-]{2,})\\s*,\\s*[${UC}]`, "g");

export function collectAuthorSurnames({ bibliography, citations, references } = {}, siglaCodes) {
  const set = new Set();
  const addWord = (raw) => {
    const w = normWord(raw);
    // a real surname has no interior period — this rejects initials ("A.H."),
    // which must stay full caps beside the small-capped surname (Aʜ Sᴄʜᴜᴛᴢ → A.H. Sᴄʜᴜᴛᴢ)
    if (w.length < 3 || w.includes(".") || !IS_UC_WORD.test(w) || ROMAN.test(w)) return;
    if (PARTICLES.has(w.toLowerCase())) return;
    set.add(w);
  };
  const add = (author) => { if (author) for (const raw of String(author).split(/\s+/)) addWord(raw); };
  // also mine surnames listed inline in an entry's text (reviewers in a "CR de RO"
  // list, co-authors) so they small-cap consistently with authors that have their
  // own entry — otherwise "Cʜᴀᴍʙᴇʀs … LUCAS …" mixes styles in one sentence.
  const harvest = (text) => {
    if (!text) return;
    for (const m of String(text).matchAll(CITED_NAME)) addWord(m[1]);
  };
  for (const v of Object.values(bibliography || {})) {
    if (Array.isArray(v)) for (const e of v) if (e) {
      add(e.author); harvest(e.text);
      // compte rendus nest under their work now — mine the reviewer names too
      if (Array.isArray(e.reviews)) for (const r of e.reviews) if (r) harvest(r.text);
    }
  }
  for (const a of (citations && citations.abbreviations) || []) {
    add(a.bibliography && a.bibliography.author);
    harvest(a.definition);
  }
  for (const r of (references && references.resolved) || []) add(r.target && r.target.author);
  if (siglaCodes) for (const c of siglaCodes) set.delete(c);
  return set;
}

// Wrap author surnames in already-rendered HTML. Operates only on text *between*
// tags, so markup, attributes and entities are never touched. `sigla` (a Set/Map
// of siglum codes) is excluded so a code is never mistaken for a name.
export function wrapAuthorNames(html, surnames, sigla) {
  if ((!surnames || !surnames.size) || !html) return html;
  return String(html).replace(/<[^>]*>|[^<]+/g, (chunk) =>
    chunk[0] === "<" ? chunk : wrapNamesText(chunk, surnames, sigla));
}

// strip a leading elision ("d'AGUILAR" -> "AGUILAR", "l'Auteur" -> "Auteur")
const stripEl = (w) => w.replace(ELISION, "");
// title-case surnames that are also common publisher/place words: only wrapped
// as a name when an initial (not merely a given name) precedes them.
const AMBIG_TC = new Set(["Press"]);
function wrapNamesText(text, surnames, sigla) {
  text = text.replace(GLUED_INITIALS, "$1 $2");       // "E.HOEPFFNER" -> "E. HOEPFFNER"
  text = text.replace(GLUED_INIT_TC, "$1 $2");        // "C.Appel" -> "C. Appel"
  const toks = [];
  for (let m; (m = WORD_RE.exec(text)); ) toks.push({ w: m[0], i: m.index, end: m.index + m[0].length });

  // an all-caps surname, allowing a leading elision ("d'AGUILAR") which the
  // renderer keeps lowercase before the small-capped core.
  const isSurnameTok = (w) => {
    const c = nameCore(stripEl(w));
    return IS_SURNAME.test(c) && c.replace(/[-'’]/g, "").length >= 3
      // reject a Roman numeral or a numeral range ("VIII", "VII-VIII")
      && !c.split("-").every((p) => ROMAN.test(p))
      && !(sigla && sigla.has(c));
  };
  // a title-cased token whose upper-case form is a KNOWN surname ("Appel" ->
  // "APPEL"): only ever wrapped when an initial flags it as a personal name
  // (see below), so given names that happen to match ("Frank M. Chambers")
  // are left alone.
  const isKnownTCName = (w) => {
    const c = nameCore(stripEl(w));
    return IS_FIRST.test(c) && !c.endsWith(".")
      && surnames && surnames.has(c.toUpperCase())
      && !(sigla && sigla.has(c.toUpperCase()));
  };
  // a particle is only absorbed when it is itself all-caps — i.e. part of the
  // name run ("DE BRUYNE", "AGULIO I FUSTER"), never a lowercase preposition
  // ("études de SCHULTZ-GORA") nor a given-name initial ("E.").
  const isPartTok = (w) => !/[a-zà-öø-ÿ]/.test(w) && !/\.$/.test(w)
    && PARTICLES.has(nameCore(w).toLowerCase());

  let out = "", cursor = 0;
  for (let j = 0; j < toks.length; j++) {
    const t = toks[j];
    if (t.i < cursor) continue;
    const caps = isSurnameTok(t.w);
    const tc = !caps && isKnownTCName(t.w);
    if (!caps && !tc) continue;
    const prev = toks[j - 1];
    const pw = prev ? prev.w.replace(ELISION, "") : "";       // "d'Yves" -> "Yves"
    const adjacent = prev && /^\s*$/.test(text.slice(prev.end, t.i)); // no punctuation between
    if (caps) {
      // wrap when the surname is known, flagged by a preceding given-name /
      // initial / honorific (so cited authors absent from the bibliography are
      // still caught), or itself carries an elision ("de/d'" + CAPS = a name).
      const signalled = adjacent && (IS_INITIAL.test(pw) || IS_FIRST.test(pw) || HONORIFIC.has(pw));
      const elided = ELISION.test(t.w);
      if (!surnames.has(nameCore(stripEl(t.w))) && !signalled && !elided) continue;
    } else {
      // a title-cased known surname is a name when an initial or a given name
      // precedes it adjacently ("C. Appel", "W.T. Pattison", "Carl Appel").
      // Publisher/place homographs that are also real surnames ("Press" — as in
      // Alan Press) need the stricter initial signal, so "Minnesota Press" and
      // "University Press" stay roman.
      const strict = AMBIG_TC.has(nameCore(stripEl(t.w)));
      const ok = adjacent && (IS_INITIAL.test(pw) || (!strict && IS_FIRST.test(pw)));
      if (!ok) continue;
    }
    // grow the run over compound surnames and interior/leading particles, but
    // only across plain whitespace — a comma ("LEFEVRE, I)") ends the name.
    const spaced = (a, b) => /^\s*$/.test(text.slice(a.end, b.i));
    let s = j, e = j;
    if (caps) {
      while (s - 1 >= 0 && isPartTok(toks[s - 1].w) && spaced(toks[s - 1], toks[s])) s--;
      while (e + 1 < toks.length && (isSurnameTok(toks[e + 1].w) || isPartTok(toks[e + 1].w))
        && spaced(toks[e], toks[e + 1])) e++;
    }
    const from = toks[s].i, to = toks[e].end;
    const slice = text.slice(from, to);
    const tail = (slice.match(NAME_TAIL) || [""])[0];
    let core = slice.slice(0, slice.length - tail.length);
    const el = (core.match(ELISION) || [""])[0];             // keep "d'" lowercase, outside the caps
    if (el) core = core.slice(el.length);
    out += text.slice(cursor, from) + el
      + `<span class="sc">${esc(titleCaseName(core))}</span>` + tail;
    cursor = to;
  }
  return out + text.slice(cursor);
}
function shortTitle(s, max = 38) {
  let t = String(s || "").replace(/[*_]/g, "").split(/[,(]/)[0].trim();
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return t;
}
export function makeSiglumIndex(citations, md) {
  const idx = new Map();
  for (const a of citations.abbreviations || []) {
    let short;
    if (a.bibliography && a.bibliography.author) {
      short = titleCaseName(a.bibliography.author);
      const t = shortTitle(a.bibliography.title);
      if (t) short += ", " + t;
    } else {
      short = shortTitle(a.definition, 44);
    }
    // spelled-out short cite for double-duty page references (rule 9):
    // "P.-C., p. 258" -> "A. Pillet et H. Carstens, <em>Bibliographie…</em>, p. 258".
    // Prefer the full author group from the siglum DEFINITION ("Author, *Title*"),
    // which carries co-authors the bibliography's single author field drops.
    let pageShort = null;
    const dm = (a.definition || "").match(/^(.+?),?\s*\*([^*]+)\*/);
    if (dm) {
      pageShort = dm[1].replace(/[,.]$/, "").trim() + ", <em>" + esc(shortTitle(dm[2])) + "</em>";
    } else if (a.bibliography && a.bibliography.author) {
      const t = shortTitle(a.bibliography.title);
      pageShort = titleCaseName(a.bibliography.author) + (t ? ", <em>" + esc(t) + "</em>" : "");
    }
    idx.set(a.siglum, {
      siglum: a.siglum,
      definition: a.definition,
      defHtml: md ? md.renderInline(a.definition) : "",
      short,
      pageShort,
      href: "/abbreviations/#" + encodeURIComponent(a.siglum),
    });
  }
  return idx;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// markdown -> plain text for tooltips (drop *italics*/'quotes', unwrap ^sup^)
function stripMd(s) {
  return (s || "")
    .replace(/\^([^\s^\[\]]{1,20})\^/g, "$1")
    .replace(/[*'"]/g, "").replace(/\s+/g, " ").trim();
}
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// a back-reference phrase inside a footnote: op./ouv./art./loc. cité, or ibid.
const BACKREF_PHRASE = /(?:op|ouv|art|loc)\.?\s*cit[ée]?\.?|ibid\.?/gi;

function splitLabel(label) {
  const m = label.match(/^(.*)-([^-]+)$/);
  return m ? [m[1], m[2]] : [label, ""];
}

// A sentence really ends with . ! ? … : (a colon introduces a following block).
// Trailing ")" / "]" / quotes are stripped first, so a paragraph broken
// mid-sentence after "(30)" is NOT seen as finished — but "(voir ibid.)" is.
const TERM_END = /[.!?:…]$/;
const TRAILING_CLOSERS = /[)\]»”"'’\s]+$/u;
// Real headings in the text are ATX (# …) or set in full caps ("CHANSON I :
// REMARQUES"). The keyword branch is deliberately case-SENSITIVE: without it, a
// paragraph continuing across a page break with a lowercase "chanson", "index",
// "conclusion"… would be misread as a heading and refuse to merge.
const HEADING = /^(?:#{1,6}\s|CHANSON\b|CONCLUSION\b|VERS\s+UNE\s+PO|INDEX\b|BIBLIOGRAPHIE\b|AVANT[\s-]*PROPOS|TABLE\s+DES\b)/;

function isHeading(text) {
  // unwrap typescript-faithful underline spans ("[CHANSON I ]{.underline} :…") so
  // the keyword branch still fires on the bare text.
  const s = text.trim().replace(/\[([^\]]*)\]\{\.underline\}/g, "$1");
  if (HEADING.test(s)) return true;
  // an all-caps line (letter-spaced headings, roman-numeral titles, …)
  return /[A-ZÀ-Þ]/.test(s) && !/[a-zà-ÿ]/.test(s) && s.length <= 64;
}

function endsTerminal(text) {
  const t = text
    .replace(/\[\^[^\]]*\]/g, "")     // footnote refs
    .replace(/[*_`]/g, "")            // emphasis marks
    .replace(TRAILING_CLOSERS, "")    // trailing ) ] » " ' and space
    .trimEnd();
  return t === "" || TERM_END.test(t);
}

// Two paragraphs split by a page boundary belong together whenever the first
// does not finish a sentence. In running body text a paragraph never ends
// mid-sentence, so a non-terminal last line is always a continuation — even
// when the next line begins with a capital ("…Linda" / "M. Paterson…").
function mergeable(prevRaw, nextText) {
  if (isHeading(prevRaw) || isHeading(nextText)) return false;
  if (/^</.test(prevRaw) || /^</.test(nextText)) return false; // raw html blocks
  return !endsTerminal(prevRaw);
}

function anchorSpan(pid, ctx) {
  // an invisible scroll target for cross-refs, PLUS (when the page carries a
  // printed number) a small inline pill marking the page break; clicking it opens
  // that sheet in the facsimile view (site js/edition.js).
  const printed = ctx && ctx.printedOf && ctx.printedOf.get(pid);
  const pill = printed
    ? `<button type="button" class="page-pill" data-page="${pid}"`
      + ` title="Page ${printed} — voir le fac-similé"`
      + ` aria-label="Page ${printed}, voir le fac-similé">${printed}</button>`
    : "";
  const cls = printed ? "page-anchor page-marker" : "page-anchor";
  return `<span class="${cls}" id="page-${pid}" data-page="${pid}">${pill}</span>`;
}

// split a section's markdown into page blocks by the <!-- page: --> anchors
function splitPages(markdown) {
  const pages = [];
  let cur = null;
  for (const line of markdown.split("\n")) {
    const m = line.match(PAGE_ANCHOR);
    if (m) { cur = { pid: m[1], lines: [] }; pages.push(cur); }
    else if (cur) cur.lines.push(line);
    else { cur = { pid: null, lines: [line] }; pages.push(cur); }
  }
  return pages;
}

// A section break the typescript set as "+", "+ +", "* * *"… — an asterism.
const ASTERISM_LINE = /^([+*⁂]\s*)+$/;

// The typography normaliser reflowed markdown tables onto one line. Rebuild
// the row structure: the column count comes from the |---|---| separator run,
// then the token stream regroups into rows of that width (row junctions must
// be empty tokens, else we leave the paragraph untouched).
function rebuildTable(text) {
  const sep = text.match(/\|(\s*:?-{3,}:?\s*\|)+/);
  if (!sep) return null;
  const cols = (sep[0].match(/-{3,}/g) || []).length;
  if (cols < 2) return null;
  const toks = text.split("|");
  if (toks.length < 2 || toks[0].trim() !== "") return null;
  toks.shift();
  if (toks.at(-1).trim() === "") toks.pop();
  const rows = [];
  let i = 0;
  while (i < toks.length) {
    const row = toks.slice(i, i + cols);
    if (row.length < cols) return null;
    rows.push("| " + row.map((c) => c.trim()).join(" | ") + " |");
    i += cols;
    if (i < toks.length) {
      if (toks[i].trim() !== "") return null; // junction between rows
      i += 1;
    }
  }
  return rows.length >= 3 ? rows.join("\n") : null;
}

// classify a page's body into ordered blocks (footnote defs are dropped — they
// render as sidenotes at their reference). Paragraphs are single logical lines
// after typography normalisation; verse/quote divs pass through as div blocks.
function parseBlocks(lines) {
  const blocks = [];
  let para = [];
  const pushPara = () => {
    if (!para.length) return;
    const text = para.join(" ");
    para = [];
    const table = text.startsWith("|") ? rebuildTable(text) : null;
    blocks.push(table ? { type: "table", text: table } : { type: "para", text });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const s = line.trim();
    if (FN_DEF.test(line)) { pushPara(); continue; }
    if (DIV_OPEN.test(line)) {
      pushPara();
      const { cls, attr } = parseAttrs(line.match(DIV_OPEN)[1]);
      const inner = [];
      i++;
      while (i < lines.length && !DIV_CLOSE.test(lines[i])) inner.push(lines[i++]);
      blocks.push({ type: "div", cls, attr, inner });
      continue;
    }
    if (s === "") { pushPara(); continue; }
    if (ASTERISM_LINE.test(s)) {
      pushPara();
      if (blocks.at(-1)?.type !== "asterism") blocks.push({ type: "asterism" });
      continue;
    }
    if (isHeading(s)) { pushPara(); blocks.push({ type: "para", text: s, heading: true }); continue; }
    para.push(s);
  }
  pushPara();
  return blocks;
}

// Internal cross-references, resolved only in the modernised reading views:
//   "infra/supra (…) p. N"   -> the anchor of printed page N (unique across the
//                               edition), in whatever section now holds it;
//   "à ROMAN,verse"          -> the chanson study view at that verse.
// Both link within the site; the printed Livre view keeps the bare text.
const XREF_PAGE = new RegExp(
  `(<em>(?:infra|supra|ci-dessous|ci-dessus)</em>[^<.]{0,20}?)\\bp(p?)\\.\\s*(\\d+)((?:\\s*[-–]\\s*\\d+)?)`, "gi");
// \b is ASCII-only, so "\bà" never matches after a space (à is not a word char);
// use a Unicode letter lookbehind instead.
const XREF_CHANSON = /(?<![\p{L}])(à|au)\s+([IVXLC]{1,8})\s*,\s*(\d{1,3})(?![\d])/gu;
const NNBSP2 = " ";
function linkCrossRefs(html, ctx) {
  if (ctx.printedToPage && ctx.pageToSection) {
    html = html.replace(XREF_PAGE, (whole, lead, pp, n, range) => {
      const pid = ctx.printedToPage.get(n);
      const slug = pid && ctx.pageToSection.get(pid);
      if (!slug) return whole;
      return `${lead}<a class="xref" href="/${slug}/#page-${pid}">p${pp}.${NNBSP2}${n}${range}</a>`;
    });
  }
  if (ctx.romanToNum) {
    html = html.replace(XREF_CHANSON, (whole, prep, roman, verse) => {
      const num = ctx.romanToNum[roman];
      if (!num || +verse < 1 || +verse > 160) return whole; // guard journal vols
      return `${prep} <a class="xref" href="/chansons/${num}/#v${verse}">${roman},${verse}</a>`;
    });
  }
  return html;
}

function renderPara(raw, ctx) {
  const { md, sigla } = ctx;
  let html = md.render(raw);
  html = injectSidenotes(html, ctx);
  // reading views: sigla open the typeset tooltip; the faithful Livre view keeps
  // the click-to-expand disclosure.
  html = ctx.normalize ? renderSiglaAbbr(html, sigla, ctx) : linkSigla(html, sigla);
  html = wrapAuthorNames(html, ctx.surnames, ctx.sigla);
  return ctx.normalize ? linkCrossRefs(html, ctx) : html;
}

// --- exports used by the chanson study parser (lib/chanson.js) ---------------
export function renderProse(raw, ctx) { return renderPara(raw, ctx); }
export function renderInlineApparatus(raw, ctx) {
  let h = ctx.md.renderInline(raw);
  h = injectSidenotes(h, ctx);
  h = ctx.normalize ? renderSiglaAbbr(h, ctx.sigla, ctx) : linkSigla(h, ctx.sigla);
  h = wrapAuthorNames(h, ctx.surnames, ctx.sigla);
  return ctx.normalize ? linkCrossRefs(h, ctx) : h;
}
// Render a bibliography inline string the same way the reading views do: a known
// siglum (RO, RvO, MLN, Arch.Rom.…) becomes a hover-card reference, any REMAINING
// underlined span is a journal/collection name the typescript typed underlined
// (= italics) rather than a siglum, and author surnames become small caps.
//   ctx = { md, sigla, siglaCodes, surnames }
export function renderBibInline(raw, ctx) {
  let h = ctx.md.renderInline(String(raw || ""));
  h = renderSiglaAbbr(h, ctx.sigla, ctx);
  h = h.replace(/<span class="underline">([^<]*)<\/span>/g, "<em>$1</em>");
  return wrapAuthorNames(h, ctx.surnames, ctx.siglaCodes);
}
export { endsTerminal, mergeable, isHeading, stripTags };

// ======================================================= facsimile rendering
// A deliberately spartan render of a single typescript page, for the Livre
// view's "facsimilé" toggle: no colour, no small-caps, no sigla tooltips — the
// text is kept exactly as it was typed (full-caps authors, underlined sigla),
// footnote calls become plain superscripts and the notes are gathered at the
// foot of the page, numbered as in the typescript (the suffix of the label,
// "v1p009-3" -> 3). It never touches the reading-view counters or context.
function fxNoteInner(def, ctx) {
  // notes keep the printed look; only footnote calls nested in a note (rare)
  // collapse to a bare superscript so nothing dangles.
  let h = ctx.md.renderInline(def).replace(FN_PUNCT, "$2[^$1]");
  return h.replace(FN_REF, (whole, label) => `<sup>${splitLabel(label)[1] || "*"}</sup>`);
}
function fxSidenotes(html, ctx, nm) {
  html = html.replace(FN_PUNCT, "$2[^$1]");
  return html.replace(FN_REF, (whole, label) => {
    const n = splitLabel(label)[1] || "*";
    const def = ctx.defs[label];
    if (def !== undefined && !nm.seen.has(label)) {
      nm.seen.add(label);
      nm.notes.push({ n, html: fxNoteInner(def, ctx) });
    }
    return `<sup class="fx-ref">${n}</sup>`;
  });
}
function fxDiv(cls, attr, inner, ctx, nm) {
  const classAttr = cls.length ? ` class="${cls.join(" ")}"` : "";
  const langAttr = attr.lang ? ` lang="${attr.lang}"` : "";
  const isVerse = cls.includes("verse") || !!attr.lang;
  const nonEmpty = inner.filter((l) => l.trim());
  const indent = nonEmpty.length ? Math.min(...nonEmpty.map((l) => l.match(/^ */)[0].length)) : 0;
  const dedent = (l) => l.slice(indent);
  if (isVerse) {
    const lines = [...inner];
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    const body = lines.map((l) => l.trim() ? fxSidenotes(ctx.md.renderInline(dedent(l)), ctx, nm) : "").join("\n");
    return `<div${classAttr}${langAttr} data-verse>${body}</div>`;
  }
  return `<div${classAttr}${langAttr}>\n${fxSidenotes(ctx.md.render(inner.map(dedent).join("\n")), ctx, nm)}\n</div>`;
}

// First/last-block shape of a facsimile page, for cross-page continuation
// detection. lastOpen = the last block is a paragraph not ending on terminal
// punctuation (a sentence runs off the foot); firstIsPara = the page opens on a
// plain paragraph (so it can be a continuation, not a fresh heading/verse block).
export function facsimilePageMeta(rawText) {
  const lines = rawText.split(String.fromCharCode(10)).filter((l) => !PAGE_ANCHOR.test(l));
  // footnote definitions sit at the page foot; ignore them (and anything after the
  // first one) so first/last blocks reflect the BODY text that flows page-to-page.
  // Otherwise the last block is a note def (ends with a period ⇒ looks terminal),
  // and the next page's continuation never loses its new-paragraph indent.
  const isDef = (l) => { const t = l.trimStart(); return t.startsWith("[^") && t.indexOf("]:") > 2; };
  const cut = lines.findIndex(isDef);
  const blocks = parseBlocks(cut >= 0 ? lines.slice(0, cut) : lines);
  const first = blocks[0];
  const last = blocks.at(-1);
  const lastIsPara = !!(last && last.type === "para" && !last.heading);
  return {
    firstIsPara: !!(first && first.type === "para" && !first.heading),
    lastOpen: lastIsPara && !endsTerminal(last.text),
  };
}

// Render one page's raw markdown into { html, notes } for the facsimile view.
// opts.contFrom: this page's first paragraph continues the previous page, so it
// drops the new-paragraph indent (the last line of a page is left as typed).
export function renderFacsimilePage(rawText, ctx, opts = {}) {
  const lines = rawText.split("\n").filter((l) => !PAGE_ANCHOR.test(l));
  const blocks = parseBlocks(lines);
  const nm = { notes: [], seen: new Set() };
  const parts = [];
  for (const b of blocks) {
    if (b.type === "div") parts.push(fxDiv(b.cls, b.attr, b.inner, ctx, nm));
    else if (b.type === "asterism") parts.push('<p class="fx-ast">* * *</p>');
    else if (b.heading) parts.push(`<p class="fx-h">${fxSidenotes(ctx.md.renderInline(b.text), ctx, nm)}</p>`);
    else parts.push(`<p>${fxSidenotes(ctx.md.render(b.text), ctx, nm).replace(/^<p>|<\/p>\s*$/g, "")}</p>`);
  }
  // continuation tags: plain paragraphs render as "<p>…", headings/verse/asterism
  // carry a class, so a leading "<p>" identifies the plain body paragraphs.
  const firstPlain = parts.findIndex((p) => p.startsWith("<p>"));
  if (opts.contFrom && firstPlain >= 0) parts[firstPlain] = parts[firstPlain].replace("<p>", '<p class="fx-cont-from">');
  return { html: parts.join(String.fromCharCode(10)), notes: nm.notes };
}

// Render one index page for the facsimile view, reproducing the typescript's
// column layout (which book.md's reflow lost). Word indexes (mots / N.W.) become
// a two-column list — lemma left, reference at a fixed tab; the author index
// keeps one entry per line with the page list hung under its first number.
// The bare "x"/"x x" OCR artifacts and the reflowed run-on structure are dropped.
export function renderIndexFacsimilePage(rawText, ctx, opts = {}) {
  const isWord = opts.slug === "index-mots" || opts.slug === "index-nw";
  const lines = rawText.split("\n").filter((l) => !PAGE_ANCHOR.test(l));
  const nm = { notes: [], seen: new Set() };
  const isDef = (l) => { const t = l.trimStart(); return t.startsWith("[^") && t.indexOf("]:") > 2; };
  const parts = [];
  for (const raw of lines) {
    const s = raw.trim();
    if (!s || isDef(s)) continue;
    if (/^I\s*N\s*D\s*E\s*X/i.test(s)) {
      parts.push(`<p class="fx-h">${fxSidenotes(ctx.md.renderInline(s), ctx, nm)}</p>`);
      continue;
    }
    if (isWord) {
      if (!/^[-–]\s/.test(s)) continue; // skip stray "x", "x x" typescript artifacts
      // one source line = one alphabetical group (the "- A… — B…" runs), spaced
      // apart as in the typescript.
      const rows = splitWordEntries(s.replace(/^[-–]\s*/, "")).map(({ lemma, ref }) => {
        const lem = fxSidenotes(ctx.md.renderInline(lemma), ctx, nm);
        // reference is clickable but keeps the typewriter look (invisible fx-ilink)
        const rf = ref ? linkWordIndex(fxSidenotes(ctx.md.renderInline(ref), ctx, nm), ctx, { cls: "fx-ilink" }) : "";
        return `<div class="ix-row"><span class="ix-lem">- ${lem}</span>`
          + `<span class="ix-ref">${rf}</span></div>`;
      });
      if (rows.length) parts.push(`<div class="ix-group">${rows.join("\n")}</div>`);
      continue;
    }
    const k = authorIndent(s);
    const authHTML = linkAuthorIndex(fxSidenotes(ctx.md.renderInline(s), ctx, nm), ctx, { cls: "fx-ilink" });
    parts.push(`<div class="ix-auth" style="--ind:${k}ch">${authHTML}</div>`);
    // the typescript sets a five-dot separator between author entries
    parts.push('<p class="ix-sep" aria-hidden="true">.....</p>');
  }
  // drop a trailing separator so a page never ends on the dots
  if (parts.length && parts.at(-1).includes("ix-sep")) parts.pop();
  const cls = isWord ? "fx-index fx-index-words" : "fx-index fx-index-auth";
  return { html: `<div class="${cls}">${parts.join("\n")}</div>`, notes: nm.notes };
}

// Render one section's markdown to HTML, merging paragraphs that a page boundary
// split (the next page's anchor is kept inline so back-ref links still resolve).
//   ctx = { md, defs (global), sigla, refIndex, pageToSection, sidenoteCounter }
export function renderSection(markdown, ctx) {
  const pages = splitPages(markdown);
  const out = [];
  let carry = null; // { raw } — an unfinished paragraph continuing onto the next page
  // the study (web) view suppresses page anchors (ctx.pageAnchors === false) so
  // it never duplicates the #page-… ids the faithful Livre body already carries.
  const anchor = (pid) => (ctx.pageAnchors === false ? "" : anchorSpan(pid, ctx));

  const flushCarry = () => { if (carry) { out.push(renderPara(carry.raw, ctx)); carry = null; } };

  for (const pg of pages) {
    const blocks = parseBlocks(pg.lines);
    let start = 0;
    const b0 = blocks[0];
    if (carry && b0 && b0.type === "para" && !b0.heading && mergeable(carry.raw, b0.text)) {
      // continue the carried paragraph across the page boundary; anchor goes inline
      const merged = `${carry.raw} ${pg.pid ? anchor(pg.pid) : ""} ${b0.text}`;
      if (blocks.length === 1 && !endsTerminal(b0.text)) carry = { raw: merged };
      else { out.push(renderPara(merged, ctx)); carry = null; }
      start = 1;
    } else {
      flushCarry();
      if (pg.pid) out.push(anchor(pg.pid));
    }
    for (let k = start; k < blocks.length; k++) {
      const b = blocks[k];
      const isLast = k === blocks.length - 1;
      if (b.type === "div") { flushCarry(); out.push(renderDiv(b.cls, b.attr, b.inner, ctx)); continue; }
      if (b.type === "table") { flushCarry(); out.push(renderPara(b.text, ctx)); continue; }
      if (b.type === "asterism") {
        flushCarry();
        if (!out.at(-1)?.includes('class="asterism"'))
          out.push('<p class="asterism" aria-hidden="true">⁂</p>');
        continue;
      }
      flushCarry();
      if (isLast && !b.heading && !endsTerminal(b.text)) carry = { raw: b.text };
      else out.push(renderPara(b.text, ctx));
    }
  }
  flushCarry();
  return out.join("\n");
}

function renderDiv(cls, attr, inner, ctx) {
  const { md, sigla } = ctx;
  const classAttr = cls.length ? ` class="${cls.join(" ")}"` : "";
  const langAttr = attr.lang ? ` lang="${attr.lang}"` : "";
  const isVerse = cls.includes("verse") || !!attr.lang;
  // strip a common leading indent (some fences + their lines are indented) while
  // keeping internal hemistich gaps intact
  const nonEmpty = inner.filter((l) => l.trim());
  const commonIndent = nonEmpty.length
    ? Math.min(...nonEmpty.map((l) => l.match(/^ */)[0].length)) : 0;
  const dedent = (l) => l.slice(commonIndent);
  if (isVerse) {
    // drop blank lines at the very top/bottom of the fence — under
    // white-space:pre-wrap they would render as empty leading/trailing lines
    // (the "too much space before the verse" bug); internal stanza gaps stay.
    const lines = [...inner];
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    // preserve line structure + hemistich gaps; render each line's inline markdown
    const body = lines
      .map((l) => {
        if (!l.trim()) return "";
        let h = md.renderInline(dedent(l));
        h = injectSidenotes(h, ctx);
        h = linkSigla(h, sigla);
        return wrapAuthorNames(h, ctx.surnames, ctx.sigla);
      })
      .join("\n");
    return `<div${classAttr}${langAttr} data-verse>${body}</div>`;
  }
  // prose quote / other div: render inner as normal markdown block
  let h = md.render(inner.map(dedent).join("\n"));
  h = injectSidenotes(h, ctx);
  h = linkSigla(h, sigla);
  h = wrapAuthorNames(h, ctx.surnames, ctx.sigla);
  return `<div${classAttr}${langAttr}>\n${h}\n</div>`;
}

// A note call directly before sentence punctuation moves after it (typographic
// convention). NNBSP/NBSP that precedes French high punctuation moves with it.
const FN_PUNCT = /\[\^([^\]]+)\]((?:[  ]?[.,;:!?…])+)/g;

// Replace [^label] refs with note markup, resolving defs globally. Two modes:
//   inline (study view): a toggleable disclosure at the reference site;
//   panel  (ctx.notesOut is an array): the ref becomes a numbered anchor and
//          the note text is collected for the section's synced notes panel.
function injectSidenotes(html, ctx) {
  const { md, defs, sigla } = ctx;
  const norm = ctx.normalize ? (ctx.footnoteNorm && ctx.footnoteNorm.get) : null;
  html = html.replace(FN_PUNCT, "$2[^$1]");
  return html.replace(FN_REF, (whole, label) => {
    let def = defs[label];
    ctx.sidenoteCounter.n += 1;
    if (def === undefined) {
      // unmatched ref (should not happen: reconciliation is 0/0) — leave a marker
      return `<sup class="sidenote-missing" title="footnote ${label} not found">*</sup>`;
    }
    const nrm = ctx.normalize && ctx.footnoteNorm ? ctx.footnoteNorm.get(label) : null;
    if (ctx.normalize) {
      // All rewrites that carry markdown (*italic* short titles, « titles ») run on
      // the RAW def, so straight quotes still stand and the original *…* emphasis
      // around an abbr is consumed rather than nested (rules 3-7, 11).
      if (nrm && nrm.titles) for (const t of nrm.titles) def = def.split(t.from).join(t.to);
      if (nrm && nrm.backrefs) def = applyBackrefNorm(def, nrm.backrefs);
      def = normalizeNoteTypography(def);         // pp.->p. + NNBSP (rule 11)
    }
    let inner = md.renderInline(def);
    if (ctx.normalize) {
      inner = renderSiglaAbbr(inner, sigla, ctx); // <abbr>+conspectus link (rule 10)
    } else {
      inner = linkSigla(inner, sigla, new Set());
      inner = linkBackrefs(inner, label, ctx);
    }
    inner = wrapAuthorNames(inner, ctx.surnames, ctx.sigla);
    if (ctx.notesOut) {
      ctx.noteN += 1;
      // ctx.idPrefix ("lv-") namespaces the note ids when two rendered bodies of
      // the same section coexist on one page (Version web + Version livre).
      const nid = (ctx.idPrefix || "") + label;
      ctx.notesOut.push({ label: nid, n: ctx.noteN, html: inner });
      return `<a class="fnref" id="fnref-${nid}" href="#fn-${nid}" ` +
        `aria-label="Note ${ctx.noteN}"><sup>${ctx.noteN}</sup></a>`;
    }
    const id = "sn-" + label;
    return (
      `<label for="${id}" class="margin-toggle sidenote-number"></label>` +
      `<input type="checkbox" id="${id}" class="margin-toggle"/>` +
      `<span class="sidenote">${inner}</span>`
    );
  });
}

// Turn "op./art./loc. cité" and "ibid." inside a note into links to the work
// they point at, using references.json (resolved back-refs, keyed by page|note).
function linkBackrefs(inner, label, ctx) {
  const { refIndex, pageToSection } = ctx;
  if (!refIndex) return inner;
  const [pageid, note] = splitLabel(label);
  const refs = refIndex.get(pageid + "|" + note);
  if (!refs || !refs.length) return inner;
  let i = 0;
  return inner.replace(BACKREF_PHRASE, (m) => {
    const r = refs[i++];
    if (!r || !r.target) return m;
    const slug = pageToSection && pageToSection.get(r.target.page);
    if (!slug) return m;
    const title = esc(stripMd(`${r.target.author}, ${r.target.title}`));
    return `<a class="backref" href="/${slug}/#page-${r.target.page}" ` +
      `title="${title}" data-conf="${r.confidence || ""}">${m}</a>`;
  });
}

// ---- reading-view normalization (livre view keeps the printed text) --------

// A back-ref abbr in raw markdown, optionally wrapped in its own *…* emphasis
// (which we consume, so the markdown replacement's own emphasis never nests).
const BACKREF_MD = /\*{0,2}\s*(?:(?:op|ouv|art|loc)\.?\s*cit[ée]?\.?|ibid\.?)\s*\*{0,2}/gi;

// Replace the i-th back-ref abbr with its precomputed short-cite markdown
// (footnote-normalization.json, in note order — the same positional model
// linkBackrefs relies on). Values are markdown; render happens afterwards.
function applyBackrefNorm(def, subs) {
  if (!subs || !subs.length) return def;
  let i = 0;
  return def.replace(BACKREF_MD, (m) => {
    const s = subs[i++];
    return s && s.to != null ? s.to : m;
  });
}

// rule 11: "pp." -> "p." (both numbers), NNBSP between p. and the number.
const NNBSP = " ";
function normalizeNoteTypography(def) {
  return def
    .replace(/\bpp\.\s*/g, "p." + NNBSP)
    .replace(/\bp\.\s*(?=[\dixvlcIXVLC])/g, "p." + NNBSP);
}

// rule 10: render a siglum as an in-place reference that opens a richly typeset
// tooltip (the full citation, with author small-caps and italic titles) on
// hover/focus — it does NOT navigate. A discreet link to the conspectus lives
// inside the tooltip for readers who want the full apparatus. rule 9 double-duty:
// a siglum used as a PAGE reference (siglum + p.) is spelled out as a short cite
// instead of the code; a siglum used for NUMBERING keeps the code.
// The outer element is an <abbr> on purpose: renderSiglaAbbr's plain-text pass
// skips anything inside <a>/<abbr>, so the visible code and the definition inside
// the tooltip are never re-scanned (and never double-wrapped) as sigla.
function siglumRef(hit, tok, ctx) {
  const def = wrapAuthorNames(hit.defHtml, ctx && ctx.surnames, ctx && ctx.siglaCodes);
  return `<abbr class="siglum-ref" tabindex="0" ` +
    `aria-label="${esc(stripMd(stripTags(hit.definition)))}"><span class="sr-code">${tok}</span>` +
    `<span class="siglum-pop"><span class="sp-code">${esc(hit.siglum)}</span>` +
    `<span class="sp-def">${def}</span>` +
    `<a class="sp-link" href="${hit.href}" tabindex="-1">Sigles &amp; abréviations →</a>` +
    `</span></abbr>`;
}
// rule 9 applies ONLY to sigla with a double duty (catalogue/numbering AND the
// physical book): P.-C. = Pillet-Carstens Bibliographie ("P.-C. 389,1" numbering
// vs "P.-C., p. 258" page ref). Reference-work sigla (RO, SW, LR…) are NOT double
// duty — they always stay as linked sigla (rules 8, 10), never spelled out.
const NUMBERING_SIGLA = new Set(["P.-C.", "P.C.", "P.–C.", "BdT", "BEdT", "RS"]);

function renderSiglaAbbr(html, sigla, ctx) {
  const pageSpell = (tok) => {
    const k = tok.trim();
    const hit = sigla.get(k);
    return hit && hit.pageShort && NUMBERING_SIGLA.has(k) ? hit.pageShort : null;
  };
  // A) underlined double-duty siglum used as a PAGE reference -> spelled short cite
  //    (rule 9), checked BEFORE the abbr wrap so "[P.-C.]{.underline}, p. 258" spells.
  html = html.replace(
    /<span class="underline">([^<]+)<\/span>(\s*,?\s*pp?\.)/g, (whole, tok, tail) => {
      const ps = pageSpell(tok);
      return ps ? ps + tail : whole;
    });
  // B) any remaining underlined siglum -> reference tooltip (numbering / standalone)
  html = html.replace(/<span class="underline">([^<]+)<\/span>/g, (whole, tok) => {
    const hit = sigla.get(tok.trim());
    return hit ? siglumRef(hit, tok, ctx) : whole; // ms. siglum / emphasis stays underlined
  });
  if (!ctx.siglaCodes) return html;
  // C) plain-text sigla (e.g. "P.-C.", "BdT", "RS"), longest-first so "P.-C." wins.
  //    Only touch text OUTSIDE existing <a>/<abbr> elements (never re-wrap B's output).
  const keys = [...sigla.keys()].filter((k) => k && k.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (!keys.length) return html;
  const alt = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|");
  const pageRe = new RegExp("(?<![\\wÀ-ÿ])(" + alt + ")(\\s*,?\\s*pp?\\.)", "g");
  const bareRe = new RegExp("(?<![\\wÀ-ÿ])(" + alt + ")(?![\\wÀ-ÿ])", "g");
  const applyText = (txt) => txt
    .replace(pageRe, (mm, k, tail) => {          // rule 9 double-duty page ref
      const ps = pageSpell(k);
      return ps ? ps + tail : mm;
    })
    .replace(bareRe, (mm, k, offset, whole) => { // numbering use / standalone -> ref
      // a bare siglum directly followed by an elided continuation is part of a
      // longer italic title ("Leys d'Amors"), not the abbreviation — leave it.
      if (/^\s+[a-zà-ÿ]['’]/.test(whole.slice(offset + mm.length))) return mm;
      const h = sigla.get(k);
      return h ? siglumRef(h, k, ctx) : mm;
    });
  let depth = 0, out = "";
  const tok = /<\/?(?:a|abbr)\b[^>]*>|<[^>]+>|[^<]+/gi;
  let m;
  while ((m = tok.exec(html))) {
    const s = m[0];
    if (/^<\/?(?:a|abbr)\b/i.test(s)) {
      out += s;
      if (s[1] === "/") depth = Math.max(0, depth - 1);
      else if (!s.endsWith("/>")) depth += 1;
    } else if (s[0] === "<") {
      out += s;                                  // any other tag: leave untouched
    } else {
      out += depth > 0 ? s : applyText(s);       // text inside a/abbr: leave untouched
    }
  }
  return out;
}

// Turn an underlined token that is a known siglum into an in-place disclosure:
// click expands the full definition right there (no navigation, no broken
// flow). With `expandSeen` (a Set, one per note), the FIRST occurrence of each
// siglum in a note additionally gets a compact always-visible expansion.
function linkSigla(html, sigla, expandSeen) {
  return html.replace(/<span class="underline">([^<]+)<\/span>/g, (whole, tok) => {
    const key = tok.trim();
    const hit = sigla.get(key);
    if (!hit) return whole; // manuscript siglum / emphasis — leave underlined
    const title = esc(stripMd(stripTags(hit.definition)));
    let out = `<span class="siglum" role="button" tabindex="0" ` +
      `aria-expanded="false" title="${title}">${tok}</span>`;
    if (expandSeen && hit.short && !expandSeen.has(key)) {
      expandSeen.add(key);
      out += `<span class="siglum-x"> (${esc(hit.short)})</span>`;
    }
    out += `<span class="siglum-def" hidden>${hit.defHtml}</span>`;
    return out;
  });
}
