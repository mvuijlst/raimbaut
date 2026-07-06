// Eleventy global data: parse the assembled edition (book.md) + apparatus JSONs
// into rendered sections the templates paginate over.
//
// Segmentation is driven by manifest (reading order + kind) and chansons.json
// (exact pageid ranges), NOT by heading text — the typescript's headings are too
// irregular. Two passes: (1) assign every page to a section descriptor and build
// a pageid->section map; (2) render each section's markdown, so back-references
// (op./art. cité) can link to the section+page anchor of their target.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeMd, collectFootnoteDefs, makeSiglumIndex, renderSection,
  collectAuthorSurnames, renderFacsimilePage, facsimilePageMeta,
  renderIndexFacsimilePage, stripTags,
} from "../../lib/render.js";
import { parseChanson } from "../../lib/chanson.js";
import { buildMsIdentityIndex, parseChansonManuscrits } from "../../lib/manuscrits.js";
import { linkIndexSection, splitWordEntries } from "../../lib/indexes.js";
import { buildConcordance } from "../../lib/concordance.js";
import {
  troubadourChart, factorRankingTable, frequencyTable, groupingTable,
} from "../../lib/figures.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// normalise CRLF -> LF: book.md is Python-written in text mode on Windows, and a
// trailing \r otherwise breaks our ^…$ line regexes (anchors, footnotes).
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf-8").replace(/\r\n?/g, "\n");
const readJSON = (f) => JSON.parse(read(f));

// ---- manuscript photographs (manuscripts/ at the repo root) -----------------
// Filename convention: "ROMAN - Ms. SIGLUM - f° FOLIO - source.jpg" (parts after
// the roman numeral optional). A chanson spanning several folios has several
// files; a folio shared by two chansons appears once per chanson and is
// cross-noted automatically. Optional manuscripts/regions.json adds a caption
// note per file for folios where only part of the page belongs to the chanson:
//   { "<filename>": { "note": "colonne b, en bas du feuillet" } }
function loadManuscripts() {
  const dir = path.join(ROOT, "manuscripts");
  const byChanson = new Map();
  if (!fs.existsSync(dir)) return byChanson;
  let regions = {};
  const regionsFile = path.join(dir, "regions.json");
  if (fs.existsSync(regionsFile)) regions = JSON.parse(fs.readFileSync(regionsFile, "utf-8"));

  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f));
  const entries = [];
  for (const file of files) {
    const base = file.replace(/\.[^.]+$/, "");
    const roman = (base.match(/^([IVXL]+)\b/) || [])[1];
    if (!roman) continue;
    const siglum = (base.match(/Ms\.?\s*([A-Za-z]['’]?\d*)/) || [])[1] || null;
    const folio = (base.match(/f[°o]\s*(\d+\s*(?:bis)?\s*[rv]?)/i) || [])[1] || null;
    const source = (base.match(/(Vat\.?\s*lat\.?\s*\d+)/i) || [])[1] || null;
    entries.push({ file, roman, siglum, folio: folio && folio.replace(/\s+/g, ""), source });
  }
  // a folio shared by several chansons: same witness siglum + same folio
  // (falls back to the source-image tail when the filename has neither)
  const shareKey = (e) => (e.siglum && e.folio)
    ? e.siglum + "|" + e.folio
    : e.file.split(" - ").pop().trim();
  const sharedWith = (e) => [...new Set(entries
    .filter((o) => o !== e && shareKey(o) === shareKey(e) && o.roman !== e.roman)
    .map((o) => o.roman))];

  for (const e of entries) {
    if (!byChanson.has(e.roman)) byChanson.set(e.roman, []);
    let witness = byChanson.get(e.roman).find((w) => w.siglum === e.siglum);
    if (!witness) {
      witness = { siglum: e.siglum, source: e.source, images: [] };
      byChanson.get(e.roman).push(witness);
    }
    if (!witness.source && e.source) witness.source = e.source;
    witness.images.push({
      href: "/manuscrits/" + encodeURIComponent(e.file),
      folio: e.folio,
      shared: sharedWith(e),
      note: (regions[e.file] || {}).note || null,
    });
  }
  for (const list of byChanson.values())
    for (const w of list)
      w.images.sort((a, b) => String(a.folio).localeCompare(String(b.folio), "fr", { numeric: true }));
  return byChanson;
}

const CONCLUSION_HDR = /VERS UNE PO[EÉ]TIQUE/i;
const INDEX_HDR = /^I\s*N\s*D\s*E\s*X/i;
// letter-spaced too: the typescript's "T A B L E   D E S   M A T I E R E S"
const TDM_HDR = /T\s*A\s*B\s*L\s*E\s+D\s*E\s*S\s+M\s*A\s*T\s*I|^BIBLIOGRAPHIE\.{3,}/i;

// Editorial glosses shown at the head of an index (reading view only — the
// faithful Version livre carries the bare typescript). "N.W." is the thesis's
// own abbreviation and needs unpacking for a modern reader.
const INDEX_NOTES = {
  "index-mots": "Les mots provençaux traités dans les <em>Remarques</em> de chaque "
    + "chanson : chaque entrée renvoie à la chanson et au vers où le mot est "
    + "commenté. Développez une entrée pour lire le vers en contexte.",
  "index-nw": "« New Words » (N.W.) : les 194 vocables que Raimbaut d'Orange "
    + "semble avoir introduits dans la lyrique occitane — des mots non attestés "
    + "chez les troubadours qui le précèdent. Ils sont dégagés au terme de "
    + "l'analyse lexicale de la <a href=\"/poetique-5/\">Poétique</a>&nbsp;; "
    + "chaque référence renvoie à la chanson et au vers.",
};

// p. 52 (v1p057) carries a hand-drawn strophic/syntactic diagram. Two renderings:
// a redrawn SVG for the reading + livre views (inlined, so its ink/paper/rubric
// track the light-dark theme via CSS variables) and the PNG photograph for the
// faithful facsimile. The diagram was transcribed as the list line "- 8 8 8 7'8 8
// : a b c d e a …"; each view replaces that line with its figure.
const DIAGRAM_P52_LINE = /- 8 8 8 7['’]8 8[^\n]*?a b c d e a[^\n]*/;
const DIAGRAM_P52_SVG = (() => {
  const svg = read("images/p52.svg")
    // drop the redundant full-bleed clipPath: its single id would collide when the
    // web AND livre bodies both inline this SVG on one page.
    .replace(/<clipPath[\s\S]*?<\/clipPath>/g, "")
    .replace(/\s*clip-path="url\(#clip0_3803_262\)"/g, "")
    .replace(/<defs>\s*<\/defs>/g, "")
    // theme-aware colours (light + dark) instead of baked-in black/white/cream/red
    .replace(/fill="white"/gi, 'fill="var(--paper)"')
    .replace(/stroke="white"/gi, 'stroke="var(--paper)"')
    .replace(/fill="black"/gi, 'fill="var(--ink)"')
    .replace(/stroke="black"/gi, 'stroke="var(--ink)"')
    .replace(/fill="#F2ECDD"/gi, 'fill="var(--diagram-box)"')
    .replace(/fill="#A03123"/gi, 'fill="var(--rubric)"')
    .replace("<svg ", '<svg role="img" aria-label="Structure strophique et syntaxique du poème (p. 52)" ');
  return `<figure class="diagram diagram-p52">${svg}` +
    `<figcaption>Structure strophique et syntaxique du poème — figure redessinée ` +
    `d'après le schéma de la p. 52.</figcaption></figure>`;
})();
const DIAGRAM_P52_PNG =
  `<figure class="diagram diagram-p52 fx-diagram"><img src="/images/p52.png" ` +
  `alt="Schéma de la structure strophique du poème, p. 52 (fac-similé du tapuscrit)"/></figure>`;

// The typescript's hand-drawn figures, reconstructed from their own data at
// the exact spot where the original page carried them.
const PAGE_PATCHES = {
  // p. 52: the strophic/syntactic diagram -> redrawn, theme-aware SVG (web + livre)
  v1p057: (t) => t.replace(DIAGRAM_P52_LINE, "\n" + DIAGRAM_P52_SVG + "\n"),
  // p. 20: the three per-factor rankings (three running lists -> one table)
  v1p020: (t) => t.replace(
    /1\. Nombre de chansons par troubadour:[\s\S]*?764\)\./,
    "\n" + factorRankingTable() + "\n"),
  // p. 21: the hand-drawn "classement par position" graph -> slopegraph
  v1p021: (t) => t.replace(
    /- \[Gu\]\{\.underline\}[\s\S]*?occurrences de chansons\]\{\.underline\}\s*/,
    "\n" + troubadourChart() + "\n\n"),
  // p. 27: mean frequency of apparition (reflowed pipe text -> real table)
  v1p027: (t) => t.replace(
    /\| Bernard de Ventadour \| 11,09 \|[\s\S]*?\| Bernart Marti \| 1,33 \|/,
    "\n" + frequencyTable() + "\n"),
  // p. 29: the banded "Classement / Regroupements" comparison table
  v1p029: (t) => t.replace(
    /\| Classement d'après la fréquence[\s\S]*Marcabru \|/,
    "\n" + groupingTable() + "\n"),
};

// Facsimile-only patches (the facsimile renders from the RAW, unpatched page text).
// p. 52's diagram shows the PNG photograph here rather than the redrawn SVG.
const FACS_PATCHES = {
  v1p057: (t) => t.replace(DIAGRAM_P52_LINE, "\n" + DIAGRAM_P52_PNG + "\n"),
};

// The reading (web) view carries an editorial <h1> for each section, so the
// typescript's own heading at the top of the body ("I N T R O D U C T I O N : …",
// "AVANT - PROPOS", "INDEX DES OEUVRES …") would print the title twice. Drop that
// leading heading paragraph from the WEB body only (Livre / facsimilé stay
// faithful). A colon-introduced remainder ("… : Raimbaut d'Orange, troubadour …")
// is returned as a subtitle so it isn't lost. Diacritic/ligature/space-insensitive
// so the letter-spaced "OEUVRES" still matches the "œuvres" title.
const HEADING_NORM = (s) => s.replace(/<[^>]*>/g, "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/œ/gi, "oe").replace(/æ/gi, "ae")
  .replace(/[^a-z0-9]/gi, "").toUpperCase();
function dropPrintedHeading(html, title) {
  const nTitle = HEADING_NORM(title);
  if (!nTitle) return { html, subtitle: null };
  // scan the first few paragraphs (front matter puts a title page / dedication
  // before "AVANT - PROPOS"); strip the first SHORT one that spells out the title.
  const re = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let m, count = 0;
  while ((m = re.exec(html)) && count < 8) {
    count++;
    const inner = m[1];
    if (/fnref|sidenote|margin-toggle/.test(inner)) continue; // don't orphan a note
    const plain = inner.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (plain.length > 90) continue;                          // a content paragraph, not a heading
    if (!HEADING_NORM(inner).startsWith(nTitle)) continue;
    const ci = plain.indexOf(":");
    const subtitle = ci >= 0 ? (plain.slice(ci + 1).trim().replace(/\.\s*$/, "") || null) : null;
    return { html: html.slice(0, m.index) + html.slice(m.index + m[0].length), subtitle };
  }
  return { html, subtitle: null };
}

// "Vers une poétique…" has real internal sections (per the thesis's table des
// matières); segment on their heading lines, not on arbitrary page counts.
const normHead = (s) => s.replace(/^#{1,6}\s*/, "").replace(/[[\]*]/g, "")
  .replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const POETIQUE_PARTS = [
  { slug: "poetique-1", title: "1. Sincérité et originalité", match: (s) => normHead(s).startsWith("1. sincérité") },
  { slug: "poetique-2", title: "2. Contrainte et dynamisme de la tradition", match: (s) => normHead(s).startsWith("2. contrainte") },
  { slug: "poetique-3", title: "3. La question des trobar", match: (s) => normHead(s).startsWith("3. la question des trobar") },
  { slug: "poetique-4", title: "4. Poésie et langue naturelle", match: (s) => normHead(s).startsWith("4. poésie et langue") },
  { slug: "poetique-5", title: "5. Le lexique de Raimbaut d'Orange", match: (s) => normHead(s).startsWith("5. le lexique") },
  { slug: "conclusion", title: "Conclusion", match: (s) => s.replace(/\s+/g, "") === "CONCLUSION" },
];

export default function () {
  const book = read("book.md");
  const manifest = readJSON("manifest.json");
  const chansons = readJSON("chansons.json");
  const citations = readJSON("citations.json");
  const bibliography = readJSON("bibliography.json");
  const references = readJSON("references.json");
  // hand-authored catalogue of the collated chansonniers ("Table des
  // manuscrits"); optional, powers the standalone /manuscrits/ page. Resolved
  // against the bibliography further down (manuscriptTable).
  let manuscriptRaw = null;
  try { manuscriptRaw = readJSON("manuscripts.json"); } catch { /* not present */ }
  // footnote-reference normalization for the READING views (livre view = printed).
  // Map note_key ("v1p010-2") -> { backrefs:[…], titles:[…] }. Optional artifact.
  const footnoteNorm = new Map();
  try {
    const fn = readJSON("footnote-normalization.json");
    for (const [k, v] of Object.entries(fn.subs || {})) {
      footnoteNorm.set(k.replace("|", "-"), v);
    }
  } catch { /* not built yet: reading view falls back to printed text */ }

  const md = makeMd();
  const defs = collectFootnoteDefs(book);
  const sigla = makeSiglumIndex(citations, md);
  const siglaCodes = new Set((citations.abbreviations || []).map((a) => a.siglum));
  const surnames = collectAuthorSurnames({ bibliography, citations, references }, siglaCodes);

  // ---- per-page blocks keyed by pageid --------------------------------------
  const blocks = {};
  let cur = null;
  for (const line of book.split("\n")) {
    const m = line.match(/^<!--\s*page:\s*([^\s]+)\s*-->$/);
    if (m) { cur = m[1]; blocks[cur] = [line]; }
    else if (cur) blocks[cur].push(line);
  }
  const pageTextRaw = (pid) => (blocks[pid] ? blocks[pid].join("\n") : "");
  const pageText = (pid) =>
    PAGE_PATCHES[pid] ? PAGE_PATCHES[pid](pageTextRaw(pid)) : pageTextRaw(pid);
  const bodyText = (pid) =>
    (blocks[pid] || []).filter((l) => !l.startsWith("<!--")).join("\n").trim();

  const order = new Map(manifest.map((m) => [m.pageid, m.order]));
  const printedOf = new Map(manifest.map((m) => [m.pageid, m.printed]));
  const byOrder = [...manifest].sort((a, b) => a.order - b.order);
  const kindOf = new Map(manifest.map((m) => [m.pageid, m.kind]));

  const rpages = (c) => (c.remarques && c.remarques.pages) || [];
  const tpages = (c) => (c.texte && c.texte.pages) || [];
  const printedRange = (pids) => {
    const nums = pids.map((p) => printedOf.get(p)).filter((x) => x && /\d/.test(x));
    return nums.length ? [nums[0], nums[nums.length - 1]] : null;
  };

  const firstChansonPage = rpages(chansons[0])[0];
  const firstChOrder = order.get(firstChansonPage);

  // concluding chapter boundary (the catalogue caps XXXIX here too; belt & braces)
  const conclusionStart = byOrder.find(
    (m) => m.order > firstChOrder && CONCLUSION_HDR.test(bodyText(m.pageid)));
  const bibStart = byOrder.find((m) => m.kind === "bibliographie");
  const conclOrder = conclusionStart ? order.get(conclusionStart.pageid) : Infinity;
  const bibOrder = bibStart ? order.get(bibStart.pageid) : byOrder.length;

  const lastChanson = chansons[chansons.length - 1];
  if (lastChanson.texte)
    lastChanson.texte.pages = tpages(lastChanson).filter((p) => order.get(p) < conclOrder);

  // ================= PASS 1: build section descriptors =======================
  const descriptors = [];

  const frontPages = byOrder.filter((m) => m.order < firstChOrder).map((m) => m.pageid);
  const introIdx = frontPages.findIndex((p) => kindOf.get(p) === "introduction");
  const preIntro = introIdx > 0 ? frontPages.slice(0, introIdx) : [];
  const introPages = frontPages.filter(
    (p) => !preIntro.includes(p) && kindOf.get(p) !== "plate-or-divider");

  if (preIntro.length)
    descriptors.push({ slug: "avant-propos", kind: "front", title: "Avant-propos", subtitle: "", pages: preIntro });
  if (introPages.length)
    descriptors.push({ slug: "introduction", kind: "intro", title: "Introduction", subtitle: "", pages: introPages });

  for (const c of chansons) {
    const pids = [...rpages(c), ...tpages(c)];
    if (!pids.length) continue;
    descriptors.push({
      slug: "chanson-" + c.num, kind: "chanson", num: c.num, roman: c.roman,
      title: "Chanson " + c.roman, subtitle: (c.incipit || "").trim(), pages: pids,
    });
  }

  // concluding chapter, segmented at its real section headings
  if (conclusionStart) {
    const conclPages = byOrder
      .filter((m) => m.order >= conclOrder && m.order < bibOrder).map((m) => m.pageid);
    const lines = conclPages.map(pageText).join("\n\n").split("\n");
    const segments = POETIQUE_PARTS.map((p) => ({ ...p, lines: [] }));
    let cur = -1; // preamble before the first heading joins part 1
    const preamble = [];
    let expect = 0;
    for (const line of lines) {
      if (expect < POETIQUE_PARTS.length && POETIQUE_PARTS[expect].match(line.trim())) {
        cur = expect;
        expect += 1;
        continue; // the heading line itself becomes the page <h1>
      }
      // drop the letter-spaced part title (redundant with the chrome)
      if (cur === -1 && /^VERSUNEPO/i.test(line.replace(/\s+/g, ""))) continue;
      if (cur === -1) preamble.push(line);
      else segments[cur].lines.push(line);
    }
    segments[0].lines = [...preamble, ...segments[0].lines];
    for (const seg of segments) {
      const md = seg.lines.join("\n");
      const pids = [...md.matchAll(/<!--\s*page:\s*(\S+)\s*-->/g)].map((m) => m[1]);
      descriptors.push({
        slug: seg.slug, kind: "conclusion", title: seg.title, subtitle: "",
        pages: pids.length ? pids : [conclPages[0]], md,
      });
    }
  }

  // the three indices (each heading page -> next heading, capped before the TdM)
  const indexHeads = byOrder.filter(
    (m) => m.order > bibOrder && INDEX_HDR.test(bodyText(m.pageid)));
  const tdm = byOrder.find(
    (m) => indexHeads.length && m.order > indexHeads[0].order && TDM_HDR.test(bodyText(m.pageid)));
  const indexEnd = tdm ? order.get(tdm.pageid) : byOrder.length;
  const indexTitle = (pid) => {
    const n = bodyText(pid).slice(0, 90).replace(/\s+/g, "").toUpperCase();
    if (n.includes("MOTS")) return ["index-mots", "Index des mots"];
    if (n.includes("N.W")) return ["index-nw", "Index des N.W."];
    if (n.includes("OEUVRES") || n.includes("ŒUVRES") || n.includes("AUTEURS"))
      return ["index-oeuvres", "Index des œuvres et des auteurs occitans cités"];
    return ["index-noms", "Index des noms propres"];
  };
  for (let h = 0; h < indexHeads.length; h++) {
    const startO = indexHeads[h].order;
    const endO = (h + 1 < indexHeads.length ? indexHeads[h + 1].order : indexEnd) - 1;
    const pids = byOrder.filter((m) => m.order >= startO && m.order <= endO).map((m) => m.pageid);
    const [slug, title] = indexTitle(indexHeads[h].pageid);
    descriptors.push({ slug, kind: "index", title, subtitle: "", note: INDEX_NOTES[slug] || "", pages: pids });
  }

  // the bibliography's own pages (title page .. the first index heading): they
  // are not a linear section (bibliographie.njk is a standalone template) but
  // they need the same Version livre / fac-similé treatment, and their #page-…
  // anchors must be reachable by cross-references.
  const biblioPages = byOrder
    .filter((m) => m.order >= bibOrder
      && (!indexHeads.length || m.order < indexHeads[0].order))
    .map((m) => m.pageid);

  // ---- pageid -> section slug (for back-reference links) ---------------------
  // chanson pages resolve to the merged study URL (/chansons/N/), where the
  // faithful "Version livre" body carries the #page-… anchors that back-refs and
  // cross-refs target; other sections keep their own slug.
  const pageToSection = new Map();
  for (const d of descriptors) {
    const slug = d.kind === "chanson" ? "chansons/" + d.num : d.slug;
    for (const p of d.pages) pageToSection.set(p, slug);
  }
  for (const p of biblioPages) pageToSection.set(p, "bibliographie");

  // ---- references keyed by page|note ----------------------------------------
  const refIndex = new Map();
  for (const r of references.resolved || []) {
    const k = r.page + "|" + r.note;
    if (!refIndex.has(k)) refIndex.set(k, []);
    refIndex.get(k).push(r);
  }

  // ---- cross-reference maps (internal "infra/supra, p. N" + "à ROMAN,verse") -
  // printed page number -> pageid (printed numbers are unique across the edition);
  // chanson roman -> num, for verse links into the study views.
  const printedToPage = new Map();
  for (const [pid, pr] of printedOf) if (pr && /^\d+$/.test(String(pr))) printedToPage.set(String(pr), pid);
  const romanToNum = Object.fromEntries(chansons.map((c) => [c.roman, c.num]));

  // ================= PASS 2: render ==========================================
  const ctx = { md, defs, sigla, surnames, siglaCodes, footnoteNorm,
    sidenoteCounter: { n: 0 }, refIndex, pageToSection, printedToPage, romanToNum, printedOf };
  // index diagnostics: unresolved author-index page numbers (from linkAuthorIndex)
  // and the concordance's own unresolved references (built after the studies).
  const indexFlags = [];
  const cxFlags = { romans: new Set(), verseMiss: [], kwicMiss: [] };
  const renderPages = (pids) => renderSection(pids.map(pageText).join("\n\n"), ctx);

  // linear sections collect their footnotes into a synced notes panel.
  // per-page facsimile of the typescript ("Fac-similé paginé", for EVERY
  // section): each page is discrete, with its footnotes gathered at the foot and
  // its printed folio in the corner. Rendered from the RAW page text (no page
  // patches), so the sheets stay faithful to the typescript.
  // Two passes so a sentence that runs across a page boundary reads as continuous:
  // the page it runs ONTO drops the new-paragraph indent (contFrom) when the
  // previous page ended mid-sentence. The last line of a page is left as typed.
  const facsimileOf = (pids) => {
    const kept = pids.filter((pid) =>
      kindOf.get(pid) !== "plate-or-divider" && !/RIJKSUNIVERSITEIT/i.test(bodyText(pid)));
    const metas = kept.map((pid) => facsimilePageMeta(pageTextRaw(pid)));
    return kept
      .map((pid, i) => {
        const contFrom = i > 0 && metas[i - 1].lastOpen && metas[i].firstIsPara;
        const facsText = FACS_PATCHES[pid] ? FACS_PATCHES[pid](pageTextRaw(pid)) : pageTextRaw(pid);
        return { folio: printedOf.get(pid) || "", pid, ...renderFacsimilePage(facsText, ctx, { contFrom }) };
      })
      .filter((pg) => pg.html.trim() || pg.notes.length);
  };

  // the indexes get a dedicated facsimile pass that rebuilds the typescript's
  // two-column / hanging-indent layout (see renderIndexFacsimilePage).
  const facsimileOfIndex = (pids, slug) =>
    pids
      .filter((pid) => kindOf.get(pid) !== "plate-or-divider" && !/RIJKSUNIVERSITEIT/i.test(bodyText(pid)))
      .map((pid) => ({ folio: printedOf.get(pid) || "", pid, ...renderIndexFacsimilePage(pageTextRaw(pid), ctx, { slug }) }))
      .filter((pg) => pg.html.trim() || pg.notes.length);

  const sections = descriptors.map((d) => {
    // Version web body: EVERY continuous reading body is normalized (sigla
    // tooltips, op./art. cité + ibid. back-ref links, footnote normalization) —
    // including the chanson "Lecture continue" (Version livre), whose faithful
    // printed text survives only in the "Fac-similé paginé" sub-view.
    ctx.notesOut = [];
    ctx.noteN = 0;
    ctx.normalize = true;
    // chanson sections ARE the study page's livre-continue body: they keep the
    // #page-… anchors. Prose sections render TWICE (web + faithful livre); only
    // the livre body may carry the anchors, or the ids would duplicate.
    ctx.pageAnchors = d.kind === "chanson";
    let html = d.md != null ? renderSection(d.md, ctx) : renderPages(d.pages);
    // the author index keeps its linkified running text as its web view; the two
    // word indexes are replaced by an interactive concordance (attached after the
    // studies are built, below), so their running-text web html is left unused.
    if (d.slug === "index-oeuvres") html = linkIndexSection(html, d.slug, ctx, indexFlags);
    // drop the typescript heading that duplicates the editorial <h1> (web view only)
    let subtitle = d.subtitle;
    if (d.kind !== "chanson") {
      const stripped = dropPrintedHeading(html, d.title);
      html = stripped.html;
      if (stripped.subtitle && !subtitle) subtitle = stripped.subtitle;
    }
    const notes = ctx.notesOut;
    let livre = null;
    if (d.kind !== "chanson") {
      // Version livre / Lecture continue for the prose sections: the FAITHFUL
      // text (printed footnote refs, click-to-expand sigla, no normalization),
      // reflowed continuously. Footnote ids get an lv- prefix so the two notes
      // panels on one page never collide.
      ctx.notesOut = [];
      ctx.noteN = 0;
      ctx.normalize = false;
      ctx.pageAnchors = true;
      ctx.idPrefix = "lv-";
      const lHtml = d.md != null ? renderSection(d.md, ctx) : renderPages(d.pages);
      const fx = d.kind === "index" ? facsimileOfIndex(d.pages, d.slug) : facsimileOf(d.pages);
      livre = { html: lHtml, notes: ctx.notesOut, facsimile: fx };
      ctx.idPrefix = "";
      ctx.normalize = true;
    }
    ctx.notesOut = null;
    const facsimile = d.kind === "chanson" ? facsimileOf(d.pages) : null;
    return { ...d, subtitle, printed: printedRange(d.pages), html, notes, facsimile, livre };
  });
  // the bibliography page's Version livre: faithful continuous rendering +
  // per-page facsimilé of the typescript's bibliography. Same lv- id prefix as
  // the prose sections (the web view is the structured bibliographie.njk).
  ctx.notesOut = [];
  ctx.noteN = 0;
  ctx.normalize = false;
  ctx.pageAnchors = true;
  ctx.idPrefix = "lv-";
  const biblioLivre = {
    html: renderPages(biblioPages),
    notes: ctx.notesOut,
    facsimile: facsimileOf(biblioPages),
  };
  ctx.idPrefix = "";

  ctx.notesOut = null; // studies keep in-place note disclosures
  ctx.normalize = true; // /chansons/N/ study views are a reading view
  // the study (web) view must NOT emit #page-… anchors: the same page ids live
  // in the faithful Livre body on the same merged page, and duplicate ids would
  // shadow the back-ref targets. The Livre bodies were rendered above with
  // anchors on (default).
  ctx.pageAnchors = false;

  const nav = sections.map((s) => ({
    slug: s.slug, title: s.title, subtitle: s.subtitle, kind: s.kind, printed: s.printed,
  }));

  // ================= study views (/chansons/N/) ==============================
  // vol-boundary title pages that leaked into a texte range (e.g. XXVI) are
  // not chanson content — skip them
  const skipPage = (pid) =>
    kindOf.get(pid) === "plate-or-divider" || /RIJKSUNIVERSITEIT/i.test(bodyText(pid));

  const parChanson = new Map(
    (bibliography.par_chanson || []).map((b) => [b.chanson, b]));

  const manuscripts = loadManuscripts();

  // per-chanson "Manuscrits" shorthand → structured witness list (siglum + full
  // shelfmark from manuscripts.json + printed diplomatic-edition locus). Sigla
  // that don't resolve to a catalogued witness are reported to manuscrits-flags.md.
  const msIdent = buildMsIdentityIndex(manuscriptRaw);
  const msFlags = [];

  // the faithful "Version livre" bodies (continuous rendering + per-page
  // facsimilé) are the chanson-kind linear sections; key them by num so each
  // study can carry all three views (web / livre-continue / facsimilé) on one page.
  const livreByNum = new Map(
    sections.filter((s) => s.kind === "chanson").map((s) => [s.num, s]));

  const studies = chansons
    .filter((c) => tpages(c).length)
    .map((c) => {
      const parsed = parseChanson(c, { pageText, ctx, skipPage, roman: c.roman });
      const L = livreByNum.get(c.num);
      let tradition = parChanson.get(c.roman) || null;
      if (tradition && tradition.manuscrits) {
        const { groups, flags } = parseChansonManuscrits(tradition.manuscrits, msIdent);
        tradition = { ...tradition, manuscritsList: groups };
        for (const tok of flags) msFlags.push({ chanson: c.roman, token: tok });
      }
      return {
        num: c.num, roman: c.roman,
        incipit: (c.incipit || "").trim(),
        printed: printedRange([...rpages(c), ...tpages(c)]),
        livreSlug: "chanson-" + c.num,
        livre: L ? { html: L.html, notes: L.notes, facsimile: L.facsimile } : null,
        tradition,
        manuscripts: manuscripts.get(c.roman) || [],
        ...parsed,
      };
    });

  // ---- word-index concordances (Index des mots / des N.W.) ------------------
  // The interactive concordance is the web view of these two pages: each headword
  // links to its verses, and expands to the verse text (KWIC) joined straight from
  // the study views — one source of truth, no drift. Built here because it needs
  // the studies' verse text.
  const verseText = new Map();
  for (const st of studies) {
    const m = new Map();
    for (const s of st.strophes) for (const ln of s.lines) m.set(ln.no, stripTags(ln.html));
    verseText.set(st.num, m);
  }
  const incipitByNum = new Map(chansons.map((c) => [c.num, (c.incipit || "").trim()]));
  const studyNums = new Set(studies.map((s) => s.num));
  const wordIndexEntries = (pids) => {
    const out = [];
    for (const pid of pids)
      for (const raw of pageTextRaw(pid).split("\n")) {
        const s = raw.trim();
        if (/^[-–]\s/.test(s)) out.push(...splitWordEntries(s.replace(/^[-–]\s*/, "")));
      }
    return out;
  };
  for (const s of sections) {
    if (s.slug !== "index-mots" && s.slug !== "index-nw") continue;
    s.concordance = buildConcordance(wordIndexEntries(s.pages), {
      romanToNum, incipitByNum, studyNums, verseText, slug: s.slug, flags: cxFlags,
    });
  }

  // ---- Table des manuscrits: resolve each édition to its full bibliography
  // entry and deep-link it. The thesis's own "Manuscrits occitans" subsection
  // (id "occitan-b-4") carries the complete references the printed table cites
  // by sigla only; two éditions (Stengel Archiv LI, Pelaez Studj XVI) are absent
  // from it and stay as literal text. Assigning a stable per-entry anchor here
  // (shared object refs) lets bibliographie.njk render matching #ids.
  const bibFlat = [...(bibliography.general || []), ...(bibliography.raimbaut || [])];
  bibFlat.forEach((e, i) => { if (!e.anchor) e.anchor = "bib-" + i; });
  const resolveEd = (ref) => {
    const want = (ref.author || "").toUpperCase();
    const match = (e) =>
      (e.author || "").toUpperCase().includes(want) && (e.text || "").includes(ref.contains);
    const hit = bibFlat.filter((e) => e.section === "occitan-b-4").find(match)
      || bibFlat.find(match);
    return hit ? { text: hit.text, href: "/bibliographie/#" + hit.anchor } : null;
  };
  const resolveItem = (it) => {
    if (typeof it === "string") return { text: it };
    if (it.ref) return resolveEd(it.ref) || { text: it.text || it.ref.author, unresolved: true };
    return it;
  };
  const manuscriptTable = manuscriptRaw ? {
    note: manuscriptRaw.note,
    witnesses: (manuscriptRaw.witnesses || []).map((w) => ({
      ...w,
      editions: (w.editions || []).map((ed) => ({
        label: ed.label,
        items: (ed.items || []).map(resolveItem),
      })),
    })),
  } : null;

  // ================= unified whole-book reading spine + pager ================
  // A single sequence walked by the sticky pager on every reading page:
  //   Avant-propos → Introduction → Chansons I–XXXIX → Poétique → Conclusion
  //   → Bibliographie → Table des manuscrits → Sigles → Indices.
  // Chansons resolve to their merged study URL; the apparatus pages (standalone
  // templates, not linear sections) are spliced in just before the indices.
  // (studyNums declared with the concordance build above.)
  const spine = [];
  let bibInserted = false;
  for (const s of sections) {
    if (!bibInserted && s.kind === "index") {
      spine.push({ url: "/bibliographie/", label: "Bibliographie" });
      if (manuscriptTable) spine.push({ url: "/manuscrits/", label: "Table des manuscrits" });
      spine.push({ url: "/abbreviations/", label: "Sigles & abréviations" });
      bibInserted = true;
    }
    if (s.kind === "chanson") {
      if (studyNums.has(s.num)) spine.push({ url: "/chansons/" + s.num + "/", label: "Chanson " + s.roman });
    } else {
      spine.push({ url: "/" + s.slug + "/", label: s.title });
    }
  }
  if (!bibInserted) {
    spine.push({ url: "/bibliographie/", label: "Bibliographie" });
    if (manuscriptTable) spine.push({ url: "/manuscrits/", label: "Table des manuscrits" });
    spine.push({ url: "/abbreviations/", label: "Sigles & abréviations" });
  }

  const pager = {};
  spine.forEach((it, i) => {
    pager[it.url] = {
      prevUrl: i > 0 ? spine[i - 1].url : null,
      prevLabel: i > 0 ? spine[i - 1].label : null,
      nextUrl: i < spine.length - 1 ? spine[i + 1].url : null,
      nextLabel: i < spine.length - 1 ? spine[i + 1].label : null,
    };
  });

  // "you are here" map for the sticky sub-bar: the current page's own label +
  // (for chansons) its incipit and which views its layout switch should offer.
  const here = {};
  for (const it of spine) here[it.url] = { label: it.label };
  for (const st of studies) {
    here["/chansons/" + st.num + "/"] = {
      label: "Chanson " + st.roman,
      incipit: st.incipit,
      hasViews: true,
      hasFacsimile: !!(st.livre && st.livre.facsimile && st.livre.facsimile.length),
    };
  }
  // prose sections + bibliographie carry the same two-level view control
  for (const s of sections) {
    if (s.kind === "chanson" || !s.livre) continue;
    const h = here["/" + s.slug + "/"];
    if (h) {
      h.hasViews = true;
      h.hasFacsimile = !!(s.livre.facsimile && s.livre.facsimile.length);
    }
  }
  if (here["/bibliographie/"]) {
    here["/bibliographie/"].hasViews = true;
    here["/bibliographie/"].hasFacsimile = !!biblioLivre.facsimile.length;
  }

  // the Poétique's own spine: 5 chapters + Conclusion, in reading order — feeds
  // the /poetique/ hub and the sibling-chapter switcher in the sticky sub-bar.
  const poetique = sections
    .filter((s) => s.kind === "conclusion")
    .map((s) => {
      const m = s.title.match(/^(\d)\.\s*(.*)$/);
      return {
        url: "/" + s.slug + "/",
        title: s.title,
        short: m ? m[1] : "Conclusion",
        name: m ? m[2] : s.title,
      };
    });
  for (const chap of poetique) {
    if (here[chap.url]) here[chap.url].chapters = poetique;
  }

  // the apparatus cluster's own switcher (Bibliographie · Manuscrits · Sigles ·
  // Indices), shown in the sub-bar on every apparatus page — mirrors the
  // Poétique chapter switcher so these standalone pages stop being dead-ends.
  const IDX_SHORT = { "index-mots": "Mots", "index-nw": "N.W.", "index-oeuvres": "Œuvres" };
  const apparatus = [{ url: "/bibliographie/", short: "Bibliographie" }];
  if (manuscriptTable) apparatus.push({ url: "/manuscrits/", short: "Manuscrits" });
  apparatus.push({ url: "/abbreviations/", short: "Sigles" });
  for (const s of sections)
    if (s.kind === "index") apparatus.push({ url: "/" + s.slug + "/", short: IDX_SHORT[s.slug] || s.title });
  for (const a of apparatus) if (here[a.url]) here[a.url].apparatus = apparatus;

  // section.njk paginates the linear prose sections only — chanson-kind sections
  // are now served (merged) by chanson.njk at /chansons/N/, so exclude them here.
  const linearSections = sections.filter((s) => s.kind !== "chanson");

  // flat bibliography entries grouped by their parsed subsection id, for the
  // structured bibliographie.njk (the tree itself is bibliography.sections).
  const bibBySection = {};
  for (const list of [bibliography.general || [], bibliography.raimbaut || []])
    for (const e of list) {
      const k = e.section || "autres";
      (bibBySection[k] = bibBySection[k] || []).push(e);
    }

  // report per-chanson manuscrit sigla that didn't resolve to a catalogued
  // witness (OCR artifacts, α, lowercase/prime variants of no listed manuscript).
  // Written every build so the list stays in step with the source; fix the source
  // (corpus/ → book.md → build_bibliography.py) or manuscripts.json, then rebuild.
  {
    const byTok = new Map();
    for (const { chanson, token } of msFlags) {
      if (!byTok.has(token)) byTok.set(token, []);
      byTok.get(token).push(chanson);
    }
    let md = "# Table des manuscrits par chanson — sigles non résolus\n\n";
    md += "Sigles de témoins cités dans la « Bibliographie par chanson » (section "
      + "1. Manuscrits) qui ne correspondent à aucun témoin catalogué dans "
      + "`manuscripts.json`. Ils s'affichent tels quels, sans identification. "
      + "Corriger la source ou `manuscripts.json`, puis reconstruire.\n\n";
    if (byTok.size === 0) {
      md += "_Aucun — tous les sigles se résolvent._\n";
    } else {
      md += "| sigle | chansons |\n|---|---|\n";
      for (const [tok, chs] of [...byTok].sort((a, b) => b[1].length - a[1].length))
        md += `| \`${tok}\` | ${[...new Set(chs)].join(", ")} |\n`;
    }
    fs.writeFileSync(path.join(ROOT, "manuscrits-flags.md"), md);
  }

  // report index references that don't resolve to an existing target: an unknown
  // roman or a verse citation with no such verse in the chanson (probable OCR /
  // reading error, e.g. the stray "XXXIII, 296"), from the concordance build;
  // plus unresolved printed pages from the author index.
  {
    const romans = [...cxFlags.romans];
    const pages = [...new Set(indexFlags.filter((f) => f.type === "page").map((f) => f.page))];

    let md = "# Index — références non résolues\n\n";
    md += "Références des trois index qui ne pointent vers aucune cible existante. "
      + "Généré à chaque build ; corriger la source (`book.md`) puis reconstruire.\n\n";
    md += `## Vers introuvables (${cxFlags.verseMiss.length})\n\n`;
    md += "Chanson + vers cité qui n'existe pas dans le texte de la chanson "
      + "(lecture douteuse probable).\n\n";
    if (!cxFlags.verseMiss.length) md += "_Aucun._\n\n";
    else {
      md += "| chanson | vers cité |\n|---|---|\n";
      for (const r of cxFlags.verseMiss.sort((a, b) => a.num - b.num))
        md += `| ${r.roman} (${r.num}) | ${r.verse} |\n`;
      md += "\n";
    }
    md += `## Chiffres romains inconnus (${romans.length})\n\n`;
    md += romans.length ? romans.map((r) => `\`${r}\``).join(", ") + "\n\n" : "_Aucun._\n\n";
    md += `## Pages imprimées non résolues (${pages.length})\n\n`;
    md += pages.length ? pages.map((p) => `\`${p}\``).join(", ") + "\n" : "_Aucune._\n";
    fs.writeFileSync(path.join(ROOT, "index-flags.md"), md);
  }

  // report KWIC occurrences whose attested form the stem-matcher couldn't locate
  // with confidence: the verse line is shown unmarked, and listed here for review.
  {
    let md = "# Index — surlignages KWIC à vérifier\n\n";
    md += "Occurrences dont la forme attestée n'a pas pu être repérée dans le vers "
      + "avec certitude : le vers s'affiche sans surlignage. Vérifier / corriger.\n\n";
    if (!cxFlags.kwicMiss.length) md += "_Aucune._\n";
    else {
      md += "| mot | chanson | vers |\n|---|---|---|\n";
      for (const r of cxFlags.kwicMiss) md += `| ${r.lemma} | ${r.roman} | ${r.verse} |\n`;
    }
    fs.writeFileSync(path.join(ROOT, "index-kwic-flags.md"), md);
  }

  return {
    sections, linearSections, nav, chansons, studies, poetique, readingOrder: spine, pager, here,
    biblioLivre, bibBySection,
    romanToNum: Object.fromEntries(chansons.map((c) => [c.roman, c.num])),
    abbreviations: (citations.abbreviations || []).slice().sort((a, b) => a.siglum.localeCompare(b.siglum)),
    unresolvedSigla: citations.unresolved || [],
    manuscriptSigla: citations.manuscript_sigla || {},
    manuscriptTable,
    bibliography,
    referenceStats: references.stats,
    counts: {
      sections: sections.length, chansons: chansons.length,
      footnotes: Object.keys(defs).length,
      abbreviations: (citations.abbreviations || []).length,
      backrefs: (references.resolved || []).length,
    },
  };
}
