// Study-view parser for one chanson: turns the corpus markdown into the
// structured object the /chansons/N/ template renders.
//
//   remarques  ->  headnote + ordered lemma entries. The thesis keys its
//                  commentary with standalone lines "v.4", "vv.43-45",
//                  "v.19 sv." — a small grammar we can anchor on. Prose that
//                  flows between lemmas STAYS with the preceding entry: the
//                  remarques are a continuous essay, never popover fragments.
//   texte      ->  strophes (blank-line groups inside verse divs, whether the
//                  transcription fenced one div per strophe or one per page)
//                  with per-line numbers (printed every 5; implicit otherwise),
//                  paired with the strophe-aligned French translation
//                  paragraphs that follow the poem.
//   [[hand: …]]->  transcription-layer records of handwritten marginalia;
//                  kept as quiet asides attached to the nearest strophe.
import {
  renderSection, renderProse, renderInlineApparatus,
  endsTerminal, mergeable, stripTags,
} from "./render.js";

// v.4 | vv.43-45 | v.50-51 | v.19 sv. | vv.3sv. | vv. 53 — 55  (optional : or .)
const LEMMA = /^vv?\.\s*(\d+)(?:\s*[-–—‑]\s*(\d+))?(\s*\^?\s*svv?\.?\s*\^?)?\s*[:.]?\s*$/i;
const FN_DEF = /^\[\^[^\]]+\]:/;
const DIV_OPEN = /^\s*:{3,}\s*\{[^}]*\}\s*$/;
const DIV_CLOSE = /^\s*:{3,}\s*$/;
const PAGE_ANCHOR = /^<!--\s*page:\s*([^\s]+)\s*-->$/;
const HAND = /^\[\[hand:\s*(.+?)\]\]\s*$/;
const LINE_NO = /^(\d+)\s*[.·]\s+(.*)$/;
const CH_HEADING = /^CHANSON\b/; // uppercase only: prose "chanson XXXIX…" is not a heading

// the study (web) view keeps page provenance but WITHOUT the #page-… id: the
// merged page's faithful Livre body owns those ids as the back-ref targets.
const anchorSpan = (pid) =>
  `<span class="page-anchor" data-page="${pid}"></span>`;

// transcription records of handwritten marginalia -> quiet styled spans
const inlineHands = (s) =>
  s.replace(/\[\[hand:\s*(.+?)\]\]/g, '<span class="hand">$1</span>');

// double-or-wider spaces inside a rendered verse line are the printed
// hemistich gap of the short-line poems — give the caesura real width
const caesura = (html) =>
  html.replace(/(\S) {2,}(?=\S)/g, '$1<span class="caesura"> </span>');

function lemmaParts(line) {
  // tolerate typographic variants: italic markers (*v.v.*1-4), "v.v." for
  // "vv.", superscript artifacts (v^v^.), capital V.54
  const s = line.trim().replace(/\*/g, "")
    .replace(/^v\.\s*v\./i, "vv.").replace(/^v\^v\^\./i, "vv.");
  const m = s.match(LEMMA);
  if (!m) return null;
  const from = parseInt(m[1], 10);
  const to = m[2] ? parseInt(m[2], 10) : null;
  const open = !!m[3];
  return { from, to, open };
}

function lemmaLabel({ from, to, open }) {
  if (to) return `vv. ${from}–${to}`;
  return open ? `v. ${from} sv.` : `v. ${from}`;
}

// ---------------------------------------------------------------------------
// remarques: split page markdown into headnote + lemma entries
// ---------------------------------------------------------------------------
// the transcription sometimes set the printed heads as ATX headings
// ("# [CHANSON I ]{.underline} :…", "## v.1"), sometimes as plain lines, and
// sometimes as underline spans faithful to the typescript ("[v.1]{.underline}",
// "[CHANSON I ]{.underline} : REMARQUES"). Normalize all three to the bare text so
// the verse-lemma and heading detectors below anchor on it. (Matching only — the
// rendered lines keep their original markup, so the underline survives.)
const unwrapUnderline = (s) => s.replace(/\[([^\]]*)\]\{\.underline\}/g, "$1");
const unhash = (s) => unwrapUnderline(s.trim().replace(/^#{1,6}\s*/, "")).trim();

function parseRemarques(mdText, ctx) {
  const lines = mdText.split("\n");
  const segments = [{ lemma: null, lines: [] }];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lp = lemmaParts(unhash(line));
    const prevBlank = i === 0 || lines[i - 1].trim() === "" || PAGE_ANCHOR.test(lines[i - 1]);
    const nextBlank = i === lines.length - 1 || lines[i + 1].trim() === "" || PAGE_ANCHOR.test(lines[i + 1]);
    if (lp && prevBlank && nextBlank) segments.push({ lemma: lp, lines: [] });
    else segments.at(-1).lines.push(line);
  }

  // drop the printed heading line ("CHANSON N : REMARQUES") — redundant with
  // the panel's own label. Keep it ONLY when it carries a footnote ref (the
  // note would be lost otherwise, e.g. chanson I's note defining SW).
  const head = segments[0];
  const headingLines = [];
  head.lines = head.lines.filter((l) => {
    const s = unhash(l);
    if (CH_HEADING.test(s) || (/REMARQUE/i.test(s) && s === s.toUpperCase())) {
      if (/\[\^/.test(s)) headingLines.push(s);
      return false;
    }
    return true;
  });

  const entries = segments.slice(1).map((seg, k) => {
    const { from, to, open } = seg.lemma;
    return {
      k, from, to, open,
      id: "rem-v" + from + (to ? "-" + to : ""),
      label: lemmaLabel(seg.lemma),
      html: renderSection(inlineHands(seg.lines.join("\n")), ctx),
    };
  });
  // duplicate anchors: two lemmas on the same verse get -b suffixes
  const seen = new Map();
  for (const e of entries) {
    const n = seen.get(e.id) || 0;
    seen.set(e.id, n + 1);
    if (n) e.id += "-" + (n + 1);
  }

  return {
    heading: headingLines.map((l) => renderInlineApparatus(l, ctx)).join(" — "),
    headnote: renderSection(inlineHands(head.lines.join("\n")), ctx),
    entries,
  };
}

// ---------------------------------------------------------------------------
// texte: strophes + translation paragraphs + hand-notes, in flow order
// ---------------------------------------------------------------------------
function parseTexte(mdText, ctx) {
  const lines = mdText.split("\n");
  // flow items: {t:'v', text} | {t:'break'} | {t:'p', text} | {t:'hand', text}
  //             {t:'anchor', pid} | {t:'heading', text}
  const flow = [];
  let inDiv = false;
  let paraOpen = false;
  for (const raw of lines) {
    const line = raw;
    const s = line.trim();
    const pa = s.match(PAGE_ANCHOR);
    if (pa) { flow.push({ t: "anchor", pid: pa[1] }); paraOpen = false; continue; }
    if (FN_DEF.test(line)) { paraOpen = false; continue; }
    if (!inDiv && DIV_OPEN.test(line)) { inDiv = true; flow.push({ t: "break" }); continue; }
    if (inDiv && DIV_CLOSE.test(line)) { inDiv = false; flow.push({ t: "break" }); continue; }
    if (inDiv) {
      if (s === "") flow.push({ t: "break" });
      else flow.push({ t: "v", text: line });
      continue;
    }
    if (s === "") { paraOpen = false; continue; }
    if (/^-{3,}$/.test(s)) { paraOpen = false; continue; } // stray hr
    const hand = s.match(HAND);
    if (hand) { flow.push({ t: "hand", text: hand[1] }); paraOpen = false; continue; }
    if (CH_HEADING.test(s)) { flow.push({ t: "heading", text: s }); paraOpen = false; continue; }
    // printed asterisk-gloss to the translation ("\* me vienne en aide")
    if (/^\\\*/.test(s)) { flow.push({ t: "star", text: s.replace(/^\\\*\s*/, "") }); paraOpen = false; continue; }
    // source note for reprinted partner strophes (tensons): not a translation
    if (/^(?:\d+\.\s*)?D['’]apr[eè]s l['’][eé]d/i.test(s)) {
      flow.push({ t: "source", text: s.replace(/^\d+\.\s*/, "") });
      paraOpen = false;
      continue;
    }
    if (paraOpen) { flow.at(-1).text += " " + s; continue; }
    // a paragraph split by a page break only (anchor immediately between the
    // two halves) is ONE paragraph — rejoin it, keeping the anchor inline.
    // Same-page paragraphs are NEVER merged: strophe translations legitimately
    // end mid-sentence (the poem's own enjambment).
    const prevA = flow.at(-1), prevP = flow.at(-2);
    if (prevA && prevA.t === "anchor" && prevP && prevP.t === "p" && mergeable(prevP.text, s)) {
      flow.pop(); // drop the standalone anchor; it moves inline into the paragraph
      prevP.text += " " + anchorSpan(prevA.pid) + " " + s;
      paraOpen = true;
      continue;
    }
    flow.push({ t: "p", text: s }); paraOpen = true;
  }

  // --- strophes: group consecutive 'v' items, splitting at breaks ------------
  const strophes = [];
  let curLines = null;
  let lineNo = 0;
  const flushStrophe = () => {
    if (curLines && curLines.length) strophes.push({ i: strophes.length, lines: curLines });
    curLines = null;
  };
  // events between strophes, keyed by "after strophe index" (-1 = before all)
  const asides = []; // {after, t:'hand'|'anchor', html|pid}
  const trads = [];  // paragraph texts, merged across page boundaries
  let sawVerse = false;
  const headings = [];

  for (const item of flow) {
    if (item.t === "v") {
      if (!curLines) curLines = [];
      const m = item.text.trim().match(LINE_NO);
      let text = item.text;
      if (m) { lineNo = parseInt(m[1], 10); text = m[2]; }
      else lineNo += 1;
      // strip the common indent the div renderer would have removed
      curLines.push({ no: lineNo, text: text.replace(/^\s+/, "") });
      sawVerse = true;
      continue;
    }
    if (item.t === "break") { flushStrophe(); continue; }
    flushStrophe();
    if (item.t === "heading") { headings.push(item.text); continue; }
    if (item.t === "p" && sawVerse) {
      trads.push({ text: item.text, afterStrophe: strophes.length - 1 });
      continue;
    }
    // everything else is an aside pinned to its position in the flow
    const after = strophes.length - 1;
    if (item.t === "p") asides.push({ after, afterTrad: trads.length - 1, t: "note", text: item.text });
    else if (item.t === "anchor") asides.push({ after, afterTrad: trads.length - 1, t: "anchor", pid: item.pid });
    else asides.push({ after, afterTrad: trads.length - 1, t: item.t, text: item.text });
  }
  flushStrophe();

  return { strophes, trads, asides, headings };
}

// Strophes known to have no translation in the thesis (global strophe index).
// XXXIV opens on a strophe the manuscript leaves largely illegible; its
// translation was never printed, so pairing resumes at strophe 2.
const UNTRANSLATED = { XXXIV: [0] };

// Group-wise pairing: the print alternates a run of strophes with the run of
// their translations. Within a group, pair 1:1 only when the counts agree —
// tornadas sometimes share one translation paragraph, and lacunose strophes
// sometimes have none, so a mismatched group renders sequentially instead of
// lying about alignment.
function buildLayout(strophes, trads, asides, untranslated) {
  const groups = [];
  let sFrom = 0;
  const boundaries = [...new Set(trads.map((t) => t.afterStrophe))].sort((a, b) => a - b);
  for (const b of boundaries) {
    groups.push({
      strophes: strophes.slice(sFrom, b + 1),
      trads: trads.filter((t) => t.afterStrophe === b),
    });
    sFrom = b + 1;
  }
  if (sFrom < strophes.length)
    groups.push({ strophes: strophes.slice(sFrom), trads: [] });

  const layout = [];
  const asidesAfterStrophe = (i) => asides.filter((a) => a.t !== "anchor" && a.after === i);
  const untr = new Set(untranslated || []);
  let allPaired = strophes.length > 0;
  for (const g of groups) {
    const skipped = g.strophes.filter((s) => untr.has(s.i)).length;
    if (g.strophes.length - skipped === g.trads.length) {
      let ti = 0;
      for (const st of g.strophes) {
        if (untr.has(st.i))
          layout.push({ t: "strophe", strophe: st, asides: asidesAfterStrophe(st.i) });
        else
          layout.push({ t: "pair", strophe: st, trad: g.trads[ti++], asides: asidesAfterStrophe(st.i) });
      }
      if (skipped) allPaired = false;
    } else {
      allPaired = false;
      for (const st of g.strophes) {
        layout.push({ t: "strophe", strophe: st, asides: asidesAfterStrophe(st.i) });
      }
      for (const t of g.trads) layout.push({ t: "trad", trad: t });
    }
  }
  return { layout, allPaired };
}

// ---------------------------------------------------------------------------
export function parseChanson(c, opts) {
  const { pageText, ctx, skipPage } = opts;
  const joined = (pids) =>
    (pids || []).filter((p) => !skipPage(p)).map(pageText).join("\n\n");

  const rem = c.remarques
    ? parseRemarques(joined(c.remarques.pages), ctx)
    : { heading: "", headnote: "", entries: [] };

  const tx = parseTexte(joined((c.texte || {}).pages), ctx);

  // --- render strophes, attach lemma marks ----------------------------------
  const marksByLine = new Map();
  for (const e of rem.entries) {
    const to = e.to || e.from;
    for (let n = e.from; n <= to; n++) {
      if (!marksByLine.has(n)) marksByLine.set(n, []);
      marksByLine.get(n).push(e);
    }
  }
  // page provenance per strophe: strophes never span a page break (a page anchor
  // flushes the current strophe), so each verse's typescript page is the pid of
  // the last page anchor at or before it. Lets a verse deep-link resolve to the
  // right facsimile sheet (and book page) even though those views aren't verse-
  // addressable.
  const pageAnchors = tx.asides
    .filter((a) => a.t === "anchor")
    .sort((a, b) => a.after - b.after);
  const strophePid = (i) => {
    let pid = null;
    for (const a of pageAnchors) { if (a.after < i) pid = a.pid; else break; }
    return pid;
  };

  const lineIndex = new Map(); // no -> plain text (for lemma quotes)
  const strophes = tx.strophes.map((st) => {
    const pid = strophePid(st.i);
    return {
      i: st.i,
      lines: st.lines.map((ln) => {
        const html = caesura(renderInlineApparatus(ln.text, ctx));
        lineIndex.set(ln.no, stripTags(html));
        const marks = (marksByLine.get(ln.no) || []).filter((e) => e.from === ln.no);
        return { no: ln.no, html, pid, marks: marks.map((e) => ({ id: e.id, label: e.label })) };
      }),
    };
  });

  // quote the anchored verse(s) under each lemma heading (≤ 2 lines shown)
  for (const e of rem.entries) {
    const to = Math.min(e.to || e.from, e.from + 1);
    const qs = [];
    for (let n = e.from; n <= to; n++) if (lineIndex.has(n)) qs.push(lineIndex.get(n));
    e.quote = qs.join("  /  ") + ((e.to && e.to > to) || e.open ? "  …" : "");
    e.present = lineIndex.has(e.from);
  }

  // --- translations + asides -------------------------------------------------
  const trads = tx.trads.map((t) => ({
    afterStrophe: t.afterStrophe,
    html: renderProse(inlineHands(t.text), ctx),
  }));
  const asides = tx.asides.map((a) => ({
    ...a,
    html: a.t === "anchor" ? "" : renderInlineApparatus(inlineHands(a.text), ctx),
  }));

  const { layout, allPaired } = buildLayout(strophes, trads, asides, UNTRANSLATED[opts.roman]);
  const verseCount = strophes.reduce((n, s) => n + s.lines.length, 0);

  return {
    remarques: rem,
    heading: tx.headings.map((h) => renderInlineApparatus(h, ctx)).join(" — "),
    strophes, trads, layout, paired: allPaired, verseCount,
    anchors: asides.filter((a) => a.t === "anchor").map((a) => a.pid),
  };
}
