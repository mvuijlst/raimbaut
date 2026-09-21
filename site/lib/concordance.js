// Build the interactive concordance ("Index des mots" / "Index des N.W.") from
// the parsed index entries + the edition's own verse text. Server-rendered so the
// content lives in the HTML (search-engine and no-JS friendly); the filter, A–Z
// rail and KWIC expansion are progressive enhancement (site js/edition.js).
//
// Two design rules, from the handoff spec, are load-bearing:
//   1. Links live ONLY in the compact reference row (the verse pills). The KWIC
//      panel is context, not navigation — its lines are never links.
//   2. A chanson is named once per row and once per KWIC block, with its verses
//      listed under it — never "Chanson XXXIX" repeated per verse.
import { expandAbbreviatedVerse } from "./indexes.js";

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

const ROMAN = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"],
  [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
const toRoman = (n) => { let s = ""; for (const [v, sym] of ROMAN) while (n >= v) { s += sym; n -= v; } return s; };

const commonPrefix = (a, b) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; };

// paren-aware split on a separator char (comma) at depth 0
function splitTop(s, sep) {
  const out = []; let depth = 0, buf = "";
  for (const c of s) {
    if (c === "(") depth++; else if (c === ")") depth = Math.max(0, depth - 1);
    if (c === sep && depth === 0) { out.push(buf); buf = ""; } else buf += c;
  }
  out.push(buf);
  return out.map((x) => x.trim()).filter(Boolean);
}

// "atac(h)ar" -> ["atacar","atachar"]; "amaire (se metre)" -> ["amaire","amaire se metre"]
// (parenthesised runs are treated as optional, which also drops glosses for search).
function expandParens(s) {
  const parts = []; const re = /\(([^)]*)\)|([^()]+)/g; let m;
  while ((m = re.exec(s))) parts.push(m[1] !== undefined ? { opt: m[1] } : { lit: m[2] });
  let variants = [""];
  for (const p of parts) {
    if (p.lit !== undefined) variants = variants.map((v) => v + p.lit);
    else variants = [...variants.map((v) => v + p.opt), ...variants];
  }
  return variants;
}

// the searchable / matchable normalised forms of a headword string
function lemmaForms(display) {
  const forms = new Set();
  for (const part of splitTop(display, ","))
    for (const v of expandParens(part)) { const n = norm(v); if (n) forms.add(n); }
  return [...forms];
}

// Locate the attested (inflected) token to highlight in a verse line. Prefers an
// exact form, then a token that extends the lemma (tertre → tertres), then a
// shared stem; returns null when nothing clears the confidence bar (caller flags
// it and shows the line unmarked). Never naive-matches the bare lemma.
function findMark(text, forms) {
  let best = null;
  for (const m of text.matchAll(/\p{L}+/gu)) {
    const tn = norm(m[0]); if (!tn) continue;
    for (const f of forms) {
      if (!f) continue;
      const cp = commonPrefix(tn, f);
      const minPrefix = f.length <= 4 ? f.length : Math.max(4, Math.ceil(f.length * 0.6));
      if (!(tn === f || cp >= minPrefix)) continue;
      const score = tn === f ? 1000 + f.length
        : cp === f.length ? 500 + cp
          : cp === tn.length ? 200 + cp : cp;
      if (!best || score > best.score) best = { i: m.index, len: m[0].length, score };
    }
  }
  return best;
}

// ---- second tier: Old Occitan spelling is not fixed ------------------------
// findMark wants the token to share a long literal prefix with the headword, which
// fails on ordinary scribal/graphic variation (desir ~ dezir, cuidar ~ cujes,
// sufrir ~ soffrir, gazur ~ gasurs), on bare stems (limar ~ lim, tolre ~ tol), on
// enclitic or two-word spellings (entrencar ~ e·n trenque, malserva ~ mal serva) and
// on a dropped or added prefix (agradar ~ gradaz, rena ~ arena). This tier runs ONLY
// when findMark found nothing, and only inside the one verse the index names, so the
// worst it can do is mark the wrong word of the right line.
const skeleton = (s) => norm(s)
  .replace(/gu(?=[aeio])/g, "g").replace(/qu|q|k/g, "c").replace(/g/g, "c")
  .replace(/ign|inh|nh|gn/g, "n").replace(/ill|lh/g, "l")
  .replace(/tz|ts|ss|z|x/g, "s").replace(/ph/g, "f").replace(/[yj]/g, "i")
  .replace(/h/g, "").replace(/u/g, "o").replace(/m(?=[bp])/g, "n")
  .replace(/(.)\1+/g, "$1");

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const PREFIXES = ["es", "en", "a", "e"];
// headword -> the skeleton shapes a token may be compared with: the word itself, its
// stem (infinitive ending off), and both again without a detachable prefix
function looseShapes(display) {
  const out = new Set();
  const main = display.replace(/\([^)]*\)/g, " ");          // glosses are handled apart
  for (const part of splitTop(main, ",")) {
    const sk = skeleton(part); if (sk.length < 3) continue;
    const stem = sk.replace(/(ar|er|ir|re|r)$/, "");
    for (const w of [sk, stem.length >= 3 ? stem : sk]) {
      out.add(w);
      for (const pre of PREFIXES) if (w.startsWith(pre) && w.length - pre.length >= 4) out.add(w.slice(pre.length));
    }
  }
  return [...out];
}
const glossWords = (display) => [...display.matchAll(/\(([^)]*)\)/g)]
  .flatMap((m) => m[1].split(/[^\p{L}]+/u)).filter((w) => w.length >= 4 && !/^(voir|v|cf)$/i.test(w)).map(skeleton);

// similarity of a token to one shape: 1 = same; short shapes must match exactly
function looseScore(tok, shape) {
  if (tok[0] !== shape[0]) return 0;
  if (tok === shape) return 1;
  if (shape.length <= 3 || tok.length < 3) return tok.startsWith(shape) && shape.length >= 3 ? 0.9 : 0;
  let best = 0;
  for (const k of [shape.length - 1, shape.length, shape.length + 1]) {
    if (k < 3 || k > tok.length + 1) continue;
    best = Math.max(best, 1 - lev(shape, tok.slice(0, k)) / shape.length);
  }
  return best;
}

export function findMarkLoose(text, display) {
  const toks = [...text.matchAll(/\p{L}+/gu)].map((m) => ({ i: m.index, end: m.index + m[0].length, sk: skeleton(m[0]) }));
  // single words, then runs of 2–3 adjacent words read as one (e·n trenque, mal serva)
  const cands = [];
  for (let a = 0; a < toks.length; a++)
    for (let b = a; b < Math.min(a + 3, toks.length); b++)
      cands.push({ i: toks[a].i, len: toks[b].end - toks[a].i, sk: toks.slice(a, b + 1).map((t) => t.sk).join(""), words: b - a + 1 });
  let best = null;
  const consider = (shapes, floor, bonus) => {
    for (const c of cands) for (const sh of shapes) {
      for (const tk of [c.sk, ...PREFIXES.filter((pre) => c.sk.startsWith(pre) && c.sk.length - pre.length >= 4).map((pre) => c.sk.slice(pre.length))]) {
        const sc = looseScore(tk, sh);
        if (sc < floor) continue;
        const score = sc + bonus - (c.words - 1) * 0.02 - (tk === c.sk ? 0 : 0.03);
        if (!best || score > best.score) best = { i: c.i, len: c.len, score };
      }
    }
  };
  consider(looseShapes(display), 0.66, 1);
  if (!best) consider(glossWords(display), 0.99, 0);        // "passar (far pon e plancas)"
  return best;
}

// Parse one entry's reference string into chanson groups. Tolerant of the
// typescript's shapes: "III, 27 ; V, 41" · "XXXIX, 3, 11, 19" · "XXX, passim" ·
// "XXXVI, (14 x)" · "I, 9(a)" · "XXX, 11 (v. XVIII, 63)".
function parseRefs(ref, romanToNum, onUnknownRoman) {
  const groups = new Map();
  for (const chunk of ref.split(";")) {
    const m = chunk.trim().match(/^([IVXLC]{1,8})\s*,\s*([\s\S]*)$/);
    if (!m) continue;
    const roman = m[1]; let rest = m[2].trim();
    const num = romanToNum[roman];
    if (!num) { onUnknownRoman(roman); continue; }
    let verses;
    const freqX = rest.match(/^\(?\s*(\d+)\s*[x×]\s*\)?/i);
    if (/passim/i.test(rest) && !/\d/.test(rest.replace(/passim/i, ""))) {
      verses = [{ label: "passim", digits: null, freq: true }];
    } else if (freqX) {
      verses = [{ label: `${freqX[1]} ×`, digits: null, freq: true }];
    } else {
      rest = rest.replace(/\(\s*(?:v\.|voir|cf\.)[^)]*\)/gi, ""); // drop cross-ref notes
      // "43 — 5" is the typescript's abbreviated pair (vv. 43 and 45): the web view
      // spells the verse out, so the pill reads and links "45"
      verses = [];
      for (const v of rest.matchAll(/([—–-]\s*)?(\d+)(\([a-z0-9]\))?/gi)) {
        const prev = verses[verses.length - 1];
        const digits = v[1] && prev ? expandAbbreviatedVerse(prev.digits, v[2]) : v[2];
        verses.push({ label: digits + (v[3] || ""), digits, freq: false });
      }
    }
    if (!verses.length) continue;
    if (groups.has(num)) groups.get(num).verses.push(...verses);
    else groups.set(num, { num, roman, verses });
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
export function buildConcordance(rawEntries, opts) {
  const { romanToNum, incipitByNum, studyNums, verseText, slug, flags } = opts;
  const kid = (i) => `k-${slug}-${i}`;

  const entries = rawEntries.map(({ lemma, ref }, i) => {
    const display = lemma.toLowerCase();
    const parts = splitTop(display, ",");
    const primary = parts[0] || display;
    const secondary = parts.slice(1).join(", ") || null;
    const forms = lemmaForms(display);
    const letter = (norm(primary)[0] || "#").toUpperCase();

    const groups = parseRefs(ref, romanToNum, (r) => flags.romans.add(r)).map((g) => {
      const nolink = !studyNums.has(g.num);
      const texts = verseText.get(g.num);
      const verses = g.verses.map((v) => {
        let textHTML = null;
        if (!v.freq && !nolink) {
          const raw = texts && v.digits ? texts.get(+v.digits) : null;
          if (raw == null) {
            flags.verseMiss.push({ roman: g.roman, num: g.num, verse: v.label });
          } else {
            let mk = findMark(raw, forms);
            // not in the verse the index names, but plainly in a neighbouring one: the
            // numbering differs there — report that, don't guess inside the wrong line
            let shifted = null;
            if (!mk) {
              for (const d of [1, -1, 2, -2]) {
                const near = texts.get(+v.digits + d);
                if (near != null && findMark(near, forms)) { shifted = +v.digits + d; break; }
              }
              if (!shifted) mk = findMarkLoose(raw, display);
            }
            if (shifted) {
              textHTML = esc(raw);
              flags.kwicShift.push({ lemma: display, roman: g.roman, verse: v.label, found: shifted });
            } else if (mk) {
              textHTML = esc(raw.slice(0, mk.i)) + "<mark>" + esc(raw.slice(mk.i, mk.i + mk.len))
                + "</mark>" + esc(raw.slice(mk.i + mk.len));
            } else {
              textHTML = esc(raw);
              flags.kwicMiss.push({ lemma: display, roman: g.roman, verse: v.label });
            }
          }
        }
        return { ...v, textHTML };
      });
      return { ...g, nolink, incipit: incipitByNum.get(g.num) || null, verses };
    });

    const count = groups.reduce((n, g) => n + g.verses.length, 0);
    const search = [...new Set([...forms, ...lemmaForms(secondary || "")])].join(" ");
    return { i, display, primary, secondary, letter, search, count, groups, kid: kid(i) };
  });

  // ---- render ----
  const byLetter = new Map();
  for (const e of entries) { if (!byLetter.has(e.letter)) byLetter.set(e.letter, []); byLetter.get(e.letter).push(e); }
  const letters = [...byLetter.keys()].sort();

  const refPill = (num, v) => {
    if (v.freq) return `<a class="cx-vn" href="/chansons/${num}/" title="chanson ${toRoman(num)}">${esc(v.label)}</a>`;
    if (v.nolink) return `<span class="cx-vn nolink" title="chanson hors ligne">${esc(v.label)}</span>`;
    return `<a class="cx-vn" href="/chansons/${num}/#v${v.digits}">${esc(v.label)}</a>`;
  };
  const refsHTML = (groups) => groups.map((g) =>
    `<span class="cx-grp"><span class="cx-roman">${g.roman}</span><span class="cx-vns">`
    + g.verses.map((v) => refPill(g.num, { ...v, nolink: g.nolink })).join("") + "</span></span>").join("");

  const kwicHTML = (groups) => `<div class="cx-kwic" id="__ID__">` + groups.map((g) => {
    const inc = g.incipit ? ` · <span class="cx-inc">${esc(g.incipit)}</span>` : "";
    const lines = g.verses.map((v) => {
      const body = v.textHTML != null ? `<span class="cx-kt">${v.textHTML}</span>`
        : g.nolink ? `<span class="cx-kt off">chanson hors ligne</span>`
          : v.freq ? `<span class="cx-kt off">${esc(v.label)}</span>`
            : `<span class="cx-kt off">vers introuvable</span>`;
      const kv = v.freq ? "" : esc(v.label);
      return `<div class="cx-kl"><span class="cx-kv">${kv}</span>${body}</div>`;
    }).join("");
    return `<div class="cx-kb"><p class="cx-kh"><span class="cx-roman">${g.roman}</span>${inc}</p>${lines}</div>`;
  }).join("") + "</div>";

  let listHTML = "";
  for (const L of letters) {
    listHTML += `<h2 class="cx-letter" id="L-${L}">${L}</h2>`;
    for (const e of byLetter.get(L)) {
      const wordHTML = `<span class="cx-word"><span class="cx-primary">${esc(e.primary)}</span>`
        + (e.secondary ? ` <span class="cx-alias">, ${esc(e.secondary)}</span>` : "") + "</span>";
      const badge = e.count > 1 ? `<span class="cx-badge">${e.count} occ.</span>` : "";
      listHTML += `<div class="cx-entry" data-search="${esc(e.search)}">`
        + `<div class="cx-row">`
        + `<button type="button" class="cx-toggle" aria-expanded="false" aria-controls="${e.kid}">`
        + `<span class="cx-chev" aria-hidden="true"></span>${wordHTML}${badge}</button>`
        + `<span class="cx-refs">${refsHTML(e.groups)}</span></div>`
        + kwicHTML(e.groups).replace("__ID__", e.kid)
        + `</div>`;
    }
  }

  const railHTML = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((L) => byLetter.has(L)
    ? `<a href="#L-${L}" data-l="${L}">${L}</a>`
    : `<span class="empty" data-l="${L}">${L}</span>`).join("");

  return { letters, count: entries.length, listHTML, railHTML };
}
