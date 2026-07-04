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
} from "../../lib/render.js";
import { parseChanson } from "../../lib/chanson.js";
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
const TDM_HDR = /TABLE\s+DES\s+MATI|^BIBLIOGRAPHIE\.{3,}/i;

// The typescript's hand-drawn figures, reconstructed from their own data at
// the exact spot where the original page carried them.
const PAGE_PATCHES = {
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
    if (n.includes("OEUVRES") || n.includes("ŒUVRES") || n.includes("AUTEURS"))
      return ["index-oeuvres", "Index des œuvres et des auteurs occitans cités"];
    return ["index-noms", "Index des noms propres"];
  };
  for (let h = 0; h < indexHeads.length; h++) {
    const startO = indexHeads[h].order;
    const endO = (h + 1 < indexHeads.length ? indexHeads[h + 1].order : indexEnd) - 1;
    const pids = byOrder.filter((m) => m.order >= startO && m.order <= endO).map((m) => m.pageid);
    const [slug, title] = indexTitle(indexHeads[h].pageid);
    descriptors.push({ slug, kind: "index", title, subtitle: "", pages: pids });
  }

  // ---- pageid -> section slug (for back-reference links) ---------------------
  // chanson pages resolve to the merged study URL (/chansons/N/), where the
  // faithful "Version livre" body carries the #page-… anchors that back-refs and
  // cross-refs target; other sections keep their own slug.
  const pageToSection = new Map();
  for (const d of descriptors) {
    const slug = d.kind === "chanson" ? "chansons/" + d.num : d.slug;
    for (const p of d.pages) pageToSection.set(p, slug);
  }

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
    sidenoteCounter: { n: 0 }, refIndex, pageToSection, printedToPage, romanToNum };
  const renderPages = (pids) => renderSection(pids.map(pageText).join("\n\n"), ctx);

  // linear sections collect their footnotes into a synced notes panel.
  // Footnote references are NORMALIZED everywhere except the faithful Livre chanson
  // pages (kind === "chanson", served at /chanson-N/), which keep the printed text.
  // per-page facsimile of the typescript (Livre view toggle): only the faithful
  // chanson pages, which already keep the printed text. Each page is discrete,
  // with its footnotes gathered at the foot and its printed folio in the corner.
  // Two passes so a sentence that runs across a page boundary reads as continuous:
  // the page it runs ONTO drops the new-paragraph indent (contFrom) when the
  // previous page ended mid-sentence. The last line of a page is left as typed.
  const facsimileOf = (pids) => {
    const kept = pids.filter((pid) =>
      kindOf.get(pid) !== "plate-or-divider" && !/RIJKSUNIVERSITEIT/i.test(bodyText(pid)));
    const metas = kept.map((pid) => facsimilePageMeta(pageText(pid)));
    return kept
      .map((pid, i) => {
        const contFrom = i > 0 && metas[i - 1].lastOpen && metas[i].firstIsPara;
        return { folio: printedOf.get(pid) || "", ...renderFacsimilePage(pageText(pid), ctx, { contFrom }) };
      })
      .filter((pg) => pg.html.trim() || pg.notes.length);
  };

  const sections = descriptors.map((d) => {
    ctx.notesOut = [];
    ctx.noteN = 0;
    // EVERY continuous body is a reading view now (sigla tooltips, op./art. cité
    // + ibid. back-ref links, footnote normalization) — including the chanson
    // "Lecture continue" (Version livre). The faithful printed text survives only
    // in the "Fac-similé paginé" sub-view, rendered separately by
    // renderFacsimilePage (spartan; ignores ctx.normalize).
    ctx.normalize = true;
    const html = d.md != null ? renderSection(d.md, ctx) : renderPages(d.pages);
    const notes = ctx.notesOut;
    ctx.notesOut = null;
    const facsimile = d.kind === "chanson" ? facsimileOf(d.pages) : null;
    return { ...d, printed: printedRange(d.pages), html, notes, facsimile };
  });
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
      return {
        num: c.num, roman: c.roman,
        incipit: (c.incipit || "").trim(),
        printed: printedRange([...rpages(c), ...tpages(c)]),
        livreSlug: "chanson-" + c.num,
        livre: L ? { html: L.html, notes: L.notes, facsimile: L.facsimile } : null,
        tradition: parChanson.get(c.roman) || null,
        manuscripts: manuscripts.get(c.roman) || [],
        ...parsed,
      };
    });

  // ================= unified whole-book reading spine + pager ================
  // A single sequence walked by the sticky pager on every reading page:
  //   Avant-propos → Introduction → Chansons I–XXXIX → Poétique → Conclusion
  //   → Bibliographie → Indices.
  // Chansons resolve to their merged study URL; the bibliographie (a standalone
  // template, not a linear section) is spliced in just before the indices.
  const studyNums = new Set(studies.map((s) => s.num));
  const spine = [];
  let bibInserted = false;
  for (const s of sections) {
    if (!bibInserted && s.kind === "index") {
      spine.push({ url: "/bibliographie/", label: "Bibliographie" });
      bibInserted = true;
    }
    if (s.kind === "chanson") {
      if (studyNums.has(s.num)) spine.push({ url: "/chansons/" + s.num + "/", label: "Chanson " + s.roman });
    } else {
      spine.push({ url: "/" + s.slug + "/", label: s.title });
    }
  }
  if (!bibInserted) spine.push({ url: "/bibliographie/", label: "Bibliographie" });

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

  // section.njk paginates the linear prose sections only — chanson-kind sections
  // are now served (merged) by chanson.njk at /chansons/N/, so exclude them here.
  const linearSections = sections.filter((s) => s.kind !== "chanson");

  return {
    sections, linearSections, nav, chansons, studies, poetique, readingOrder: spine, pager, here,
    romanToNum: Object.fromEntries(chansons.map((c) => [c.roman, c.num])),
    abbreviations: (citations.abbreviations || []).slice().sort((a, b) => a.siglum.localeCompare(b.siglum)),
    unresolvedSigla: citations.unresolved || [],
    manuscriptSigla: citations.manuscript_sigla || {},
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
