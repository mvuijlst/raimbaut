#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_footnote_norm_v2.py — precompute footnote-reference normalization for the
READING views (the Livre view keeps the printed text untouched; see the plan file
binary-mixing-neumann.md).

Consumes (all UTF-8):
  book.md               footnote defs in reading order  ([^v1p010-2]: ...)
  references.json       resolved back-refs, in-note order (build_references_v2.py)
  bibliography.json     works (author / title / siglum) -> short titles, work counts
  citations.json        sigla definitions (for double-duty page-ref flags)

Emits:
  footnote-normalization.json   per-note positional replacements the renderer applies
  footnote-norm-flags.md        every uncertain / unresolved / ambiguous case (review)

RULE MAPPING (request rules 1-12):
  named back-ref "A. KOLSEN, *ouv. cité*, pp.480-487"  -> replace the abbr with the
      italic SHORT TITLE, keep the printed author + locator (rules 3,4). Author small
      caps + pp.->p.+NNBSP happen later in render.js.
  ibid. / Ibid. -> ALWAYS a self-contained short cite (reading view opens notes on
      click / in a side panel, so the preceding note isn't visible and ibid. has no
      referent — user rule 2026-07-04). Bare ibid. recovers the antecedent's page
      when unambiguous ("Initial SURNAME, *ShortTitle*, p. N"), else work-level.
  "id.", siglum+loc.cit., low-confidence / unresolved -> FLAG, italicize the Latin
      abbr, never guess (rules 6,7 + global flag instruction).
  Article titles delimited unambiguously (…'Title', dans *Journal*…) -> « Title »
      with NNBSP (rule 11, delimited-only). Everything else flagged.
Only reference FORMAT is emitted for change; locators/works/numbers are preserved.
"""
import json, io, re, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))
NNBSP = " "  # narrow no-break space


def load(name):
    with io.open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- helpers
def short_title(s, max_len=38):
    """Port of shortTitle() in site/lib/render.js."""
    t = re.sub(r"[*_]", "", str(s or ""))
    t = re.split(r"[,(]", t)[0].strip()
    if len(t) > max_len:
        t = re.sub(r"\s+\S*$", "", t[:max_len]) + "…"
    return t


def author_initial_surname(author):
    """'Alfred JEANROY' -> 'A. JEANROY'; 'Arco Silvio AVALLE' -> 'A. S. AVALLE';
    'A. KOLSEN' stays; 'KOLSEN' stays; two authors joined with ' et ' -> reduce each;
    >2 authors -> first author + ' et al.'. Surnames = ALL-CAPS run at the tail."""
    author = (author or "").strip()
    if not author:
        return ""
    # split author groups
    parts = re.split(r"\s+et\s+|\s*&\s*", author)
    if len(parts) > 2:
        return author_initial_surname(parts[0]) + " et al."
    if len(parts) == 2:
        return author_initial_surname(parts[0]) + " et " + author_initial_surname(parts[1])
    toks = author.split()
    if len(toks) == 1:
        return toks[0]  # surname only
    # trailing ALL-CAPS tokens = surname (allow hyphen/apostrophe/accented caps)
    def is_surname_tok(t):
        return bool(re.match(r"^[A-ZÀ-Þ][A-ZÀ-Þ'’\-]+$", t)) and t.upper() == t
    i = len(toks)
    while i > 0 and is_surname_tok(toks[i - 1]):
        i -= 1
    given, surname = toks[:i], toks[i:]
    if not surname:  # no all-caps surname detected; leave as printed
        return author
    inits = []
    for g in given:
        if re.fullmatch(r"(?:[A-Za-zÀ-ÿ]\.){1,3}(?:-[A-Za-zÀ-ÿ]\.?)?", g):
            inits.append(g)                       # already initials: A. / A.F. / A.-M.
        else:
            m = re.match(r"[A-Za-zÀ-ÿ]", g)
            if m:
                inits.append(m.group(0).upper() + ".")
    return (" ".join(inits) + " " if inits else "") + " ".join(surname)


def esc_html(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# back-ref phrase: op./ouv./art./loc. cité OR ibid. (mirror render.js BACKREF_PHRASE)
BACKREF = re.compile(r"(?:op|ouv|art|loc)\.?\s*cit[ée]?\.?|ibid\.?", re.I)
IBID = re.compile(r"^ibid", re.I)


def norm_work_key(t):
    """author+title identity for 'same work' comparison."""
    a = re.sub(r"[^a-zà-ÿ]", "", (t.get("author") or "").lower())
    ti = re.sub(r"[^a-zà-ÿ]", "", (t.get("title") or "").lower())[:24]
    return a + "|" + ti


# ---------------------------------------------------------------- load inputs
references = load("references.json")
bibliography = load("bibliography.json")
citations = load("citations.json")

# refs keyed and ORDERED per note (references.json is already in-note order)
ref_by_note = {}
for r in references.get("resolved", []):
    ref_by_note.setdefault((r["page"], r["note"]), []).append(r)
unresolved = {(u["page"], u["note"]): u for u in references.get("unresolved", [])}

# how many distinct works per surname (rule 3: multi-work -> always short title)
works_by_surname = {}
for e in bibliography.get("general", []) + bibliography.get("raimbaut", []):
    a = (e.get("author") or "").strip().upper()
    if a:
        works_by_surname.setdefault(a, set()).add(short_title(e.get("title"), 40))
sigla_codes = {a["siglum"] for a in citations.get("abbreviations", [])}

# ---------------------------------------------------------------- parse book.md
with io.open(os.path.join(ROOT, "book.md"), encoding="utf-8") as f:
    book = f.read().replace("\r\n", "\n").replace("\r", "\n")

DEF = re.compile(r"^\[\^(v\d+p\d+)-(\d+)\]:[ \t]?(.*)$", re.M)

subs_out = {}     # note_key -> {backrefs:[...], titles:[...]}
flags = []        # list of (page, note, phrase, reason)
stats = {"notes": 0, "backrefs": 0, "auto": 0, "ibid_resolved": 0,
         "flagged": 0, "titles": 0}

prev_target = None  # target work of the immediately-preceding reference in the stream

# every footnote def text keyed (page, note) — antecedent lookup for ibid page recovery
all_defs = {(mm.group(1), mm.group(2)): mm.group(3) for mm in DEF.finditer(book)}
LOC = re.compile(r"pp?\.\s*([0-9IVXLCivxlc]+(?:\s*[-–]\s*[0-9IVXLCivxlc]+)?)")


def antecedent_locator(target):
    """The single, unambiguous page locator of the note an ibid points back to
    (bare ibid. = same work AND same page), or None when the antecedent cites
    several pages/works — in which case we don't guess the page."""
    ant = all_defs.get((target.get("page"), target.get("note")), "")
    uniq = list(dict.fromkeys(re.sub(r"\s+", "", l) for l in LOC.findall(ant)))
    return uniq[0] if len(uniq) == 1 else None


def surname_of(author):
    toks = (author or "").split()
    caps = [t for t in toks if t.upper() == t and re.match(r"^[A-ZÀ-Þ]", t)]
    return (caps[-1] if caps else (toks[-1] if toks else "")).upper()


for m in DEF.finditer(book):
    pageid, noteno, text = m.group(1), m.group(2), m.group(3)
    key = pageid + "|" + noteno
    note_refs = ref_by_note.get((pageid, noteno), [])
    matches = list(BACKREF.finditer(text))
    if not matches:
        # still scan for delimited article titles
        pass
    stats["notes"] += 1
    backrefs = []
    ri = 0
    # positional alignment (render.js maps the i-th abbr match -> refs[i]) is only
    # trustworthy when the counts agree; otherwise an unresolved ref mid-note would
    # shift every target. Flag the whole note and auto-apply nothing (rare: ~7 notes).
    aligned = (len(matches) == len(note_refs))
    for mm in matches:
        phrase = mm.group(0)
        is_ibid = bool(IBID.match(phrase))
        ref = note_refs[ri] if ri < len(note_refs) else None
        ri += 1
        stats["backrefs"] += 1

        if not aligned:
            flags.append((pageid, noteno, phrase,
                          "match/ref count mismatch — manual review", "mismatch"))
            backrefs.append({"idx": ri - 1, "from": phrase, "kind": "flag",
                             "to": f"*{phrase}*", "conf": "flag"})
            stats["flagged"] += 1
            if ref:
                prev_target = ref["target"]
            continue
        # context: is there an author printed immediately before? (named case)
        before = text[max(0, mm.start() - 40):mm.start()]
        after = text[mm.end():mm.end() + 24]
        # a siglum right before "loc.cit" (e.g. [RO]{.underline}, *loc.cit.*)
        siglum_before = re.search(r"\b([A-Z][A-Za-z.\-]{1,6})\b[\]\}]?[,\s*]*$",
                                  re.sub(r"\{\.underline\}", "", before))
        adj_locator = bool(re.match(r"[,\s]*\*?,?\s*pp?\.", after)) or \
            bool(re.search(r"pp?\.\s*[\dixvlc]", after, re.I))

        if ref is None or ref.get("confidence") == "low":
            reason = "unresolved back-ref" if ref is None else "low-confidence resolution"
            flags.append((pageid, noteno, phrase, reason,
                          "unresolved" if ref is None else "low-conf"))
            backrefs.append({"idx": ri - 1, "from": phrase, "kind": "flag",
                             "to": f"*{phrase}*", "conf": "flag"})
            stats["flagged"] += 1
            prev_target = ref["target"] if ref else prev_target
            continue

        target = ref["target"]
        sname = surname_of(target.get("author"))
        multiwork = len(works_by_surname.get(sname, set())) > 1
        stitle = short_title(target.get("title"))
        author_disp = author_initial_surname(target.get("author"))

        if is_ibid:
            # The reading view NEVER keeps "Ibid.": footnotes open on click / show in a
            # side panel, so the immediately-preceding note isn't visible and ibid. has
            # no referent (user rule, 2026-07-04). Always emit a self-contained short
            # cite. A bare ibid. (no adjacent locator) means "same work AND same page"
            # as the antecedent, so recover that page when it is unambiguous; otherwise
            # fall back to a work-level short cite rather than guess the page.
            if adj_locator:
                to = f"{author_disp}, *{stitle}*"   # ibid.'s own following locator stays
            else:
                pg = antecedent_locator(target)
                to = f"{author_disp}, *{stitle}*" + (f", p. {pg}" if pg else "")
                if not pg:
                    flags.append((pageid, noteno, phrase,
                                  "ibid. → work-level short cite (antecedent cites "
                                  "several pages/works); page not auto-filled", "ibid-nopage"))
                    stats["flagged"] += 1
            backrefs.append({"idx": ri - 1, "from": phrase, "kind": "short-ibid",
                             "to": to, "conf": ref["confidence"]})
            stats["ibid_resolved"] += 1
        else:
            # op./ouv./art./loc. cité
            if ref["kind"] == "named":
                # author already printed before the abbr -> replace abbr with title
                title_html = f"*{stitle}*"
                backrefs.append({"idx": ri - 1, "from": phrase, "kind": "short-named",
                                 "to": title_html, "conf": ref["confidence"]})
                stats["auto"] += 1
            else:
                # bare op/loc/art cité with no author printed
                if siglum_before and siglum_before.group(1) in sigla_codes:
                    flags.append((pageid, noteno,
                                  siglum_before.group(1) + " " + phrase,
                                  "siglum kept + linked; Latin abbr italicized (rule 7); "
                                  "locator not collapsed", "siglum-latin"))
                    backrefs.append({"idx": ri - 1, "from": phrase, "kind": "flag",
                                     "to": f"*{phrase}*", "conf": "flag"})
                    stats["flagged"] += 1
                else:
                    to = f"{author_disp}, *{stitle}*"
                    backrefs.append({"idx": ri - 1, "from": phrase, "kind": "short-bare",
                                     "to": to, "conf": ref["confidence"]})
                    stats["auto"] += 1
        prev_target = target

    # ---- article-title guillemets (delimited-only, rule 11) --------------
    # Source uses straight single quotes, which collide with French elision
    # apostrophes (l', d', m', aujourd'hui). Only convert a '…' that (a) is
    # immediately followed by the article-in-journal signal ", dans *Journal*",
    # and (b) OPENS cleanly — the char before the quote is a non-letter — so an
    # elision apostrophe inside a word can never be mistaken for a title opener.
    # A title with an internal apostrophe is unmatchable here (the [^'] class
    # stops at it) and is flagged for manual conversion rather than mangled.
    titles = []
    converted_ends = []  # char offset in `text` just after each converted title
    for tm in re.finditer(r"(^|[^0-9A-Za-zÀ-ÿ])'([^']{6,110})'(\s*,?\s*dans\s+\*)", text):
        inner = tm.group(2)
        titles.append({"from": "'" + inner + "'", "to": "«" + NNBSP + inner + NNBSP + "»"})
        converted_ends.append(tm.start(3))
        stats["titles"] += 1
    # flag article-in-journal titles we did NOT convert (internal apostrophe / no
    # clean open) so they can be handled « » by hand rather than silently dropped.
    for sm in re.finditer(r",?\s*dans\s+\*", text):
        if any(abs(sm.start() - e) <= 2 for e in converted_ends):
            continue  # this journal follows a title we already converted
        seg = text[max(0, sm.start() - 120):sm.start()]
        if "'" in seg:  # a quote precedes -> a title probably lives here
            flags.append((pageid, noteno, ("…" + seg[-56:]).replace("\n", " ").strip(),
                          "article title not auto-converted (internal apostrophe) — set « » manually",
                          "title-manual"))
            stats["flagged"] += 1

    if backrefs or titles:
        subs_out[key] = {}
        if backrefs:
            subs_out[key]["backrefs"] = backrefs
        if titles:
            subs_out[key]["titles"] = titles

# ---------------------------------------------------------------- write outputs
out = {
    "_note": "Consumed by site/lib/render.js applyFootnoteNorm() in reading views only.",
    "stats": stats,
    "subs": subs_out,
}
with io.open(os.path.join(ROOT, "footnote-normalization.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

flags.sort(key=lambda x: (x[4], x[0], x[1]))
CATS = [
    ("unresolved", "Genuinely unresolved — needs manual attention",
     "No confident antecedent found (OCR-garbled surname / author never cited "
     "before). Left as printed with the Latin abbr italicized."),
    ("low-conf", "Low-confidence resolution — verify",
     "Resolver matched but with low confidence."),
    ("mismatch", "Alignment mismatch — verify",
     "The note's abbr-match count ≠ resolved-ref count, so positional targeting was "
     "not trusted. Left as printed."),
    ("title-manual", "Article title not auto-converted — set « » by hand",
     "An article-in-journal title precedes «dans *Journal*» but carries an internal "
     "straight apostrophe (French elision), so it could not be delimited safely. "
     "Left as printed; wrap in « » manually if desired."),
    ("ibid-nopage", "Ibid. → work-level short cite — optional page check",
     "The reading view never keeps « Ibid. » (notes open on click, so the preceding "
     "note isn't visible). These bare ibid. were converted to a self-contained "
     "work-level short cite, but the antecedent cites several pages/works so no single "
     "page could be filled in. Add the page by hand if you want it."),
    ("siglum-latin", "Siglum + loc./op. cit. — deliberate (rule 7), no action needed",
     "The siglum (e.g. RO = Pattison) is self-contained and is rendered as a linked "
     "abbr into the conspectus; the Latin abbr is italicized. The locator is not "
     "collapsed to a page number because loc./op. cit. stands for the antecedent "
     "page, which is not machine-known. This is the intended outcome, listed for "
     "transparency."),
]
by_cat = {}
for fl in flags:
    by_cat.setdefault(fl[4], []).append(fl)
with io.open(os.path.join(ROOT, "footnote-norm-flags.md"), "w", encoding="utf-8") as f:
    f.write("# Footnote-normalization flags (review before wiring live)\n\n")
    f.write(f"Generated by `build_footnote_norm_v2.py`. Stats: `{json.dumps(stats)}`.\n\n")
    genuine = sum(len(by_cat.get(c, [])) for c in
                  ("unresolved", "low-conf", "mismatch", "title-manual"))
    informational = len(by_cat.get("siglum-latin", [])) + len(by_cat.get("ibid-nopage", []))
    f.write(f"**{genuine} references need a human look**; {informational} more are "
            "informational (deliberate rule-7 siglum outcome + ibid. converted to a "
            "work-level short cite — optional page check).\n\n")
    for cat, title, blurb in CATS:
        rows = by_cat.get(cat, [])
        if not rows:
            continue
        f.write(f"## {title} ({len(rows)})\n\n{blurb}\n\n")
        f.write("| page | note | phrase |\n|---|---|---|\n")
        for p, n, ph, why, _ in rows:
            f.write(f"| {p} | {n} | `{ph}` |\n")
        f.write("\n")

print("footnote-normalization.json + footnote-norm-flags.md written")
print(json.dumps(stats, ensure_ascii=False))
print(f"flags: {len(flags)}")
