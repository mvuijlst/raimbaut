"""
Build bibliography.json from the REAL bibliography in vol2 (pp.470-554), which the
old footnote-harvest approach never had (the old corpus stopped at ch. XXII).

Three parts, split by printed page number (authoritative ranges from the table des
matières on v2p287):
  470-511  general bibliography  (I. Généralités: études, dictionnaires, éditions…)
  512-515  A. Ouvrages/articles directly on Raimbaut d'Orange
  516-554  B. Bibliographie par chanson  (per-chanson: Manuscrits + Éditions)

General + Raimbaut entries look like:
  - SURNAME, Prénom(s), *Titre* | 'Article', dans *Revue*, Lieu, Éditeur, année, pp. …[, [SIGLE]]
(author sometimes on its own line, title on the next). We capture author / title /
trailing siglum / full text / page / category.

Output: bibliography.json { general[], raimbaut[], par_chanson[] }.
"""
import json
import re
import unicodedata

manifest = json.load(open("manifest.json", encoding="utf-8"))
by_printed = {}
pages = []
for e in manifest:
    p = e["printed"]
    pages.append(e)
    if p.isdigit():
        by_printed[int(p)] = e

CAP = r"[A-ZÀ-ÖØ-Þ]"
SURNAME = rf"{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\.\- ]*{CAP}|{CAP}{CAP}"
SIGLUM = re.compile(r"\[([^\]]+)\]\{\.underline\}|\[([A-Z][A-Za-z.]{0,6})\]\s*$")
# the abbreviation printed at the very END of an entry ("…, (TOB)." / ", [RO]"):
# optional wrapping paren, bracketed token, optional {.underline}, optional close.
TRAILING_SIG = re.compile(r"[\s,;]*\(?\[([A-Za-zÀ-ÿ][\wÀ-ÿ.\-]{0,8})\](?:\{\.underline\})?\)?\.?\s*$")
# a line that OPENS a new author entry: "SURNAME, Given[, work…]"
NEWAUTHOR = re.compile(rf"^(?P<sur>{SURNAME})\s*,\s*(?P<rest>.*)$")
TITLE = re.compile(r"\*(?P<t1>[^*]+)\*|'(?P<t2>[^']{4,})'")
JOURNAL = re.compile(r"(?:dans|ds\.?|in)\s+\*(?P<j>[^*]+)\*", re.I)
IBIDJ = re.compile(r"\*?\bibid\.?\*?", re.I)
CHANSON_HDR = re.compile(r"^\*?CHANSON\s+([IVXL]+)\*?\s*$")
HEADING = re.compile(r"^([IVX]+\.|[A-Z]\.|\d+\.)\s")

# ---- the original hierarchy, present VERBATIM as headings in the typescript --
# I. GÉNÉRALITÉS (A. Études littéraires générales / B. Langue)
# II. OCCITAN (A. Langue / B. Littérature -> 1..4)
# III. RAIMBAUT D'ORANGE (A. Ouvrages et articles… / B. Bibliographie par chanson)
# We PARSE these heading lines (this is a parsing job, not a classification job)
# and record on each entry the id of the subsection it sits under.
H_ROMAN = re.compile(r"^#{0,4}\s*([IVX]+)\.\s+(.+?)\s*$")
H_LETTER = re.compile(r"^#{0,4}\s*([A-B])\.\s*\*?(.+?)\*?\s*$")
H_NUMBER = re.compile(r"^(\d)\.\s*\*?(.+?)\*?\s*$")
ROMAN_TITLES = {"I": "Généralités", "II": "Occitan", "III": "Raimbaut d'Orange"}
ROMAN_IDS = {"I": "generalites", "II": "occitan", "III": "raimbaut"}


def clean_title(t):
    """Normalise a heading title: strip *…*, collapse letter-spaced caps
    ("G É N É R A L I T É S" -> "Généralités"), restore the accented É the
    typewriter could not strike (Etudes -> Études, Editions -> Éditions)."""
    t = t.strip().strip("*").strip()
    toks = t.split()
    if len(toks) > 2 and all(len(x) == 1 for x in toks):
        t = "".join(toks).capitalize()
    t = re.sub(r"^E(tude|dition)", r"É\1", t)
    t = re.sub(r"\s+", " ", t)
    return t


# a rule line the OCR kept ("---") — not a heading, not an entry
RULE_LINE = re.compile(r"^-{3,}\s*$")

# a reviewer-first compte rendu listed under the reviewed work:
# "BOURCIEZ, J., [C.R. de RO]{.underline}, dans …" — surname + given, then C.R.
REVIEWER_CR = re.compile(
    rf"^(?:{SURNAME})\s*,\s*[^,]{{1,28}},?\s*\[?\s*C\.?\s*R\.?\b")


def body_lines(e):
    return [l for l in open(e["file"], encoding="utf-8").read().splitlines()
            if not l.startswith("<!-- page:")]


def looks_like_siglum(tok):
    return bool(tok) and " " not in tok and len(tok) <= 9 and tok[:1].isupper()


def norm_quotes(w):
    """Article-title single quotes -> double quotes. The opening ' sits at a boundary
    (start / after space or '('); the CLOSING ' is anchored on the journal signal
    (', dans *J*' / ', ds.' / ', in') or the entry end. Anchoring on the journal lets
    internal apostrophes (d'Italie, l'art) stay inside the title instead of ending it
    early. Titles whose closing quote was OCR-dropped find no anchor -> left as-is."""
    return re.sub(
        r"(?:(?<=^)|(?<=[\s(]))'(.+?)'(?=\s*,?\s*(?:dans|ds\.?|in)\b|\s*[.,]?\s*$)",
        r'"\1"', w)


UNDER = re.compile(r"^\[([^\]]+)\]\{\.underline\}(\s*,.*)$")   # underlined surname
REVIEW = re.compile(r"^\[?\s*C\.?\s*R\.?\b", re.I)             # "C.R." compte rendu


def new_author_head(body):
    """True if a NON-bulleted line opens a new author 'SURNAME, Given' (e.g. a review
    listed under the previous work: 'BOURCIEZ, J., [C.R. de RO]…'): a mostly-uppercase
    surname of <=30 chars followed by a comma. Underlined surnames unwrapped first."""
    m = UNDER.match(body)
    head = (m.group(1) if m else body.split(",", 1)[0]).strip()
    if not head or len(head) > 30 or "," not in body:
        return False
    letters = [c for c in head if c.isalpha()]
    return bool(len(letters) >= 2 and re.match(r"^[A-ZÀ-Þ]{2}", head)
                and sum(c.isupper() for c in letters) / len(letters) >= 0.7)


general, raimbaut = [], []
par_chanson = []      # {chanson, manuscrits, editions[], etudes[]}
cur = None            # per-chanson accumulator
flags = []            # (printed, kind, text) — OCR-damaged / ambiguous, for review

# order pages: bibliography start .. first index
bib_pages = [e for e in pages if e["printed"].isdigit() and 470 <= int(e["printed"]) <= 554]


def entry_sink(printed):
    return raimbaut if 512 <= printed <= 515 else general


# general / raimbaut: ONE entry per work, author carried forward across the blank /
# dash left-column continuations the two-column typescript OCR'd into bare lines.
cur_author = None     # "SURNAME, Given" display prefix
cur_surname = ""      # SURNAME only (downstream keying: build_citations)
cur_journal = None    # last journal cited by the current author (for ibid.)
last_entry = None     # most recently emitted work — C.R. reviews attach here
review_journal = None # last journal cited in this work's review chain (for ibid.)

# the parsed hierarchy: [{id, label, title, children:[{id, label, title, …}]}]
tree = []
cur_section = None    # id of the subsection entries are being read under


def split_author_work(rest):
    """rest = 'Given, work…' -> (given, work). Given = field up to the next comma."""
    parts = rest.split(",", 1)
    return parts[0].strip(), (parts[1].strip() if len(parts) > 1 else "")


def open_heading(s):
    """If s is a hierarchy heading, update the tree + section cursor and return
    True. Roman -> new top level; A/B -> its child; 1..4 -> child of the last
    letter node (only under II.B in the source)."""
    global cur_section
    m = H_ROMAN.match(s)
    if m and m.group(1) in ROMAN_TITLES:
        rid = ROMAN_IDS[m.group(1)]
        tree.append({"id": rid, "label": m.group(1), "title": ROMAN_TITLES[m.group(1)],
                     "children": []})
        cur_section = rid
        return True
    if not tree:
        return False
    # a real subsection title is short prose without digits or commas —
    # this rejects entry lines that merely start "A. KOLSEN, ZRPh, LVIII, 92."
    def plausible(t):
        return 2 < len(t) < 70 and "," not in t and not any(c.isdigit() for c in t)
    m = H_LETTER.match(s)
    if m and plausible(m.group(2)):
        top = tree[-1]
        nid = f"{top['id']}-{m.group(1).lower()}"
        top["children"].append({"id": nid, "label": m.group(1),
                                "title": clean_title(m.group(2)), "children": []})
        cur_section = nid
        return True
    m = H_NUMBER.match(s)
    if m and plausible(m.group(2)) and tree[-1]["children"]:
        parent = tree[-1]["children"][-1]
        nid = f"{parent['id']}-{m.group(1)}"
        parent["children"].append({"id": nid, "label": m.group(1),
                                   "title": clean_title(m.group(2))})
        cur_section = nid
        return True
    return False


def emit_review(body, printed):
    """A compte rendu (either 'C.R. par X, dans …' or reviewer-first
    'BOURCIEZ, J., C.R. de RO, dans …') nests under the reviewed work — it is
    NOT a work of the current author (the old parser prefixed it with the
    author, making Appel look like he co-authored his own reviews)."""
    global review_journal
    text = body.strip()
    if last_entry is None:
        flags.append((printed, "C.R. with no preceding work (dropped)", text[:90]))
        return
    # ibid. inside a review chain = the previous review's journal
    if IBIDJ.search(text):
        j = review_journal or cur_journal
        if j:
            text = IBIDJ.sub(f"dans *{j}*", text, count=1)
    jm = JOURNAL.search(text)
    if jm:
        review_journal = jm.group("j").strip()
    last_entry["reviews"].append({"text": text})


def emit_work(author_display, surname, work, printed, author_sig=""):
    global cur_journal, last_entry, review_journal
    work = work.strip()
    if not work:
        return
    # ibid. (= same journal as this author's previous work) -> explicit journal
    if cur_journal and IBIDJ.search(work):
        work = IBIDJ.sub(f"dans *{cur_journal}*", work, count=1)
    jm = JOURNAL.search(work)
    if jm:
        cur_journal = jm.group("j").strip()
    # title from the ORIGINAL work, preferring a quoted article title over the first
    # *italic* (which for an article is the journal, for a book is the title itself)
    aq = re.search(r"'([^']{4,})'", work)
    bi = re.search(r"\*([^*]+)\*", work)
    title = (aq.group(1) if aq else (bi.group(1) if bi else "")).strip()
    # conservative flags: unbalanced " (BARTHES) or an article-title ' never closed
    converted = norm_quotes(work)
    if work.count('"') % 2:
        flags.append((printed, "unbalanced double quote", f"{surname}: {work[:100]}"))
    if work.lstrip().startswith("'") and converted.lstrip().startswith("'"):
        flags.append((printed, "single-quoted title not auto-converted (closing quote "
                      "missing?)", f"{surname}: {work[:100]}"))
    work = converted
    # The entry's siglum is the abbreviation printed at the END of the citation
    # ("…, (TOB)." / "…, pp. 225, [RO]"): a defined shorthand FOR THIS WORK. An
    # underlined token in the MIDDLE is a journal name typed underlined = italic
    # (Archiv, Digraphe), NOT a siglum — and an underlined author surname (FRANK,
    # GHIL) is just the author. So capture only the trailing token, strip it from
    # the display text, and italicise any remaining underline as a journal.
    sig = ""
    tm = TRAILING_SIG.search(work)
    if tm and looks_like_siglum(tm.group(1)):
        sig = tm.group(1)
        work = work[:tm.start()].rstrip(" ,;.(")
    work = re.sub(r"\[([^\]]+)\]\{\.underline\}", r"*\1*", work)   # journal -> italic
    cat = "raimbaut" if 512 <= printed <= 515 else "general"
    entry = {"author": surname, "title": title, "siglum": sig,
             "text": f"{author_display}, {work}".strip(),
             "page": printed, "category": cat,
             "section": cur_section, "reviews": []}
    entry_sink(printed).append(entry)
    last_entry = entry
    review_journal = None


for e in bib_pages:
    printed = int(e["printed"])
    if printed >= 516:
        # ---- par chanson (III.B): Manuscrits / Éditions / Études ---------------
        for ln in body_lines(e):
            s = ln.strip()
            if not s or RULE_LINE.match(s):
                continue
            # the "B. Bibliographie par chanson" heading itself (before Chanson I)
            if cur is None and H_LETTER.match(s) and open_heading(s):
                continue
            ch = CHANSON_HDR.match(s)
            if ch:
                cur = {"chanson": ch.group(1), "manuscrits": "",
                       "editions": [], "etudes": []}
                par_chanson.append(cur); continue
            if cur is None:
                continue
            if re.match(r"^1\.\s*\*?Manuscrits", s):
                cur["_mode"] = "ms"; continue
            if re.match(r"^2\.\s*\*?[EÉ]ditions", s):
                cur["_mode"] = "ed"; continue
            if re.match(r"^3\.\s*\*?[EÉ]tudes", s):
                cur["_mode"] = "et"; continue
            if cur.get("_mode") == "ms":
                cur["manuscrits"] += (" " if cur["manuscrits"] else "") + s
            elif cur.get("_mode") == "ed":
                cur["editions"].append(s)
            elif cur.get("_mode") == "et":
                cur["etudes"].append(s)
        continue
    # ---- general / raimbaut: one entry per work -------------------------------
    for ln in body_lines(e):
        s = ln.strip()
        # skip blanks, "---" rules and stray printed page numbers ("478.")
        if not s or RULE_LINE.match(s) or re.fullmatch(r"\d{3}\.?", s):
            continue
        # hierarchy heading -> tree node + section cursor; breaks the author run
        if open_heading(s):
            cur_author, cur_surname, cur_journal = None, "", None
            last_entry, review_journal = None, None
            continue
        if HEADING.match(s):   # heading-shaped but unrecognised: break run + flag
            flags.append((printed, "unrecognised heading (run break)", s[:80]))
            cur_author, cur_surname, cur_journal = None, "", None
            last_entry, review_journal = None, None
            continue
        # a fully-starred SHORT line is a decorative heading; long starred lines
        # with commas are works ("*'La femme dans…', dans CCM, pp. 201-217.*")
        if (s.startswith("*") and s.endswith("*") and s.count("*") == 2
                and len(s) < 60 and "," not in s):
            cur_author, cur_surname, cur_journal = None, "", None
            last_entry, review_journal = None, None
            continue
        bulleted = s.startswith("- ")
        body = s[2:].strip() if bulleted else s
        unwrapped = re.sub(r"^\[([^\]]+)\]\{\.underline\}", r"\1", body)
        # a compte rendu, in either printed form: bare "C.R. par X, dans …" under
        # the reviewed work, or reviewer-first "BOURCIEZ, J., C.R. de RO, dans …".
        # Both nest under the last emitted work (they are reviews OF it).
        if REVIEW.match(unwrapped) or (not bulleted and REVIEWER_CR.match(unwrapped)):
            emit_review(body, printed)
            continue
        # A bullet ALWAYS opens a new author (left-column entry). A non-bulleted line
        # opens one only if it clearly starts with SURNAME, Given; otherwise
        # it is a continuation work of the current author (its title may start with
        # plain words, not just *…*/'…', so we don't test the leading char).
        new_author = (bulleted or new_author_head(body)) and body[:1] not in "*'\""
        if not new_author:
            if cur_author:
                emit_work(cur_author, cur_surname, body, printed)
            continue
        # new author. Some are cited by siglum, so their surname is underlined:
        # "[GHIL]{.underline}, Eliza M., …". Unwrap it; record the siglum if it is one.
        author_sig = ""
        um = UNDER.match(body)
        if um:
            raw = um.group(1).strip()
            if looks_like_siglum(raw):
                author_sig = raw
            body = raw + um.group(2)
        parts = body.split(",", 2)                      # surname, given, work…
        cur_surname = parts[0].strip()
        given = parts[1].strip() if len(parts) > 1 else ""
        work = parts[2].strip() if len(parts) > 2 else ""
        cur_author = f"{cur_surname}, {given}".rstrip(", ").strip()
        cur_journal = None
        emit_work(cur_author, cur_surname, work, printed, author_sig)

for c in par_chanson:
    c.pop("_mode", None)

# ===================================================================
# par-chanson short-citation resolution
# ===================================================================
# The typescript's per-chanson lists cite works in a terse sui-generis shorthand
# ("D.SCHELUDKO,[Arch.Rom.]{.underline},XXI,285" = author, journal-siglum,
# volume, page). Resolve each terse reference to the FULL entry it points at,
# catalogued elsewhere in this very bibliography (general / raimbaut, incl. the
# nested reviews), and store that full citation for display. What can't be
# matched confidently (OCR garble, works catalogued nowhere) is kept verbatim
# and flagged for manual review.
pc_flags = []       # (chanson, terse ref) left unresolved


def _deaccent(s):
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def _surkey(s):
    return re.sub(r"[^a-z]", "", _deaccent(s).lower())


def _sigkey(s):
    return re.sub(r"[^A-Z]", "", _deaccent(s).upper().replace("0", "O"))


_ROMAN = "[IVXLCDM]+"
_CITE_PT = re.compile(r"\b(" + _ROMAN + r")\s*,\s*(?:\(?\d{4}\)?\s*[,;]?\s*)?"
                      r"pp?\.?\s*(\d+)(?:\s*[—–\-]\s*(\d+))?")
_JSTOP = {"fur", "de", "des", "du", "della", "and", "the", "et", "zur", "im",
          "in", "a", "la", "le", "les", "of", "dei", "del"}
# journal sigla that must never be mistaken for an author surname in a ref
_JOURNAL_STOP = {_sigkey(x) for x in
                 "MG MLN MLR ZFSL ZRPh RPh RLR ADM NLN Archiv MW MJ RC LR SW".split()}
# anthology sigla -> (author surname key, a title keyword to disambiguate).
# MM / MJ are OCR variants of MW (Mahn, Die Werke der Troubadours).
_ANTHOLOGY = {
    "CHOIX": ("raynouard", "choix"), "RC": ("raynouard", "choix"),
    "MW": ("mahn", "werke"), "MM": ("mahn", "werke"), "MJ": ("mahn", "werke"),
    "PARNOCC": ("rochegude", "parnasse"), "PARNOCCIT": ("rochegude", "parnasse"),
}
# a bare page range "pp. 12 — 36" with no leading volume (a mélanges chapter,
# an article whose volume sits elsewhere): captured as (None, lo, hi) so the
# locus-append step knows the entry already states the page span.
_CITE_RANGE = re.compile(r"pp\.\s*(\d+)\s*[—–\-]\s*(\d+)")


def _acronym(journal):
    words = re.findall(r"[A-Za-zÀ-ÿ]+", _deaccent(journal))
    return "".join(w[0] for w in words if w.lower() not in _JSTOP).upper()


def _entry_journal(text):
    m = re.search(r"\b(?:dans|ds\.?|in)\s+\*?([^*,]{3,}?)\*?\s*,", text)
    return _acronym(m.group(1)) if m else ""


def _entry_title(text):
    m = re.search(r"\*([^*]+)\*", text) or re.search(r"[\"“']([^\"”']{5,})[\"”']", text)
    return _deaccent(m.group(1)).lower().strip(" .") if m else ""


def _citepoints(text):
    pts = [(m.group(1), int(m.group(2)), int(m.group(3) or m.group(2)))
           for m in _CITE_PT.finditer(text)]
    seen = {(lo, hi) for (_, lo, hi) in pts}
    for m in _CITE_RANGE.finditer(text):
        lo, hi = int(m.group(1)), int(m.group(2))
        if (lo, hi) not in seen:
            pts.append((None, lo, hi))
    return pts


# build the match index from every catalogued work + its nested reviews
_match_entries = []
for _e in general + raimbaut:
    _match_entries.append({"author": _e["author"], "text": _e["text"],
                           "siglum": _e["siglum"], "pts": _citepoints(_e["text"]),
                           "jac": _entry_journal(_e["text"]), "etitle": _entry_title(_e["text"])})
    for _r in _e.get("reviews", []):
        _m = re.match(r"^\s*\[?([A-ZÀ-Þ][A-Za-zÀ-ÿ.\- ]+?)[\],]", _r["text"])
        _match_entries.append({"author": _m.group(1) if _m else "", "text": _r["text"],
                               "siglum": "", "pts": _citepoints(_r["text"]),
                               "jac": _entry_journal(_r["text"]), "etitle": _entry_title(_r["text"])})
_by_sig, _by_sur = {}, {}
for _e in _match_entries:
    if _e["siglum"]:
        _by_sig.setdefault(_sigkey(_e["siglum"]), _e)
    if _e["author"]:
        field = _e["author"].split(",")[0]
        keys = {_surkey(field)}
        # also key on the bare surname minus a nobiliary particle ("de RIQUER" ->
        # "riquer", "del Monte" -> "monte") so a ref that drops the particle matches
        keys.add(_surkey(field.split()[-1]))
        for k in keys:
            if k:
                _by_sur.setdefault(k, []).append(_e)


def _title_score(rtitle, etitle):
    """Graded title match so the CLOSEST title wins when an author has several
    similar works ('Manualetto' must beat 'Manuale'): 6 = the entry title starts
    with the whole ref title, 5 = starts with a slightly-trimmed prefix (OCR
    tolerance), 4 = most ref words appear in the entry title, else 0."""
    if not rtitle or not etitle or len(rtitle) < 4:
        return 0
    if etitle.startswith(rtitle) or etitle.replace(" ", "").startswith(rtitle.replace(" ", "")):
        return 6                                   # despaced: "Trobador Gedichte" ~ "Trobadorgedichte"
    if etitle.startswith(rtitle[:max(6, len(rtitle) - 2)]):
        return 5
    rw = re.findall(r"[a-zà-ÿ]{4,}", rtitle)
    ew = re.findall(r"[a-zà-ÿ]{3,}", etitle)
    def wmatch(w):
        return any(e.startswith(w) or w.startswith(e) for e in ew)
    # a short abbreviated title ("Prov. ined.") must match ALL its words, so it
    # can't latch onto a same-author work sharing only one ("Prov. Chrestomathie")
    need = len(rw) if len(rw) <= 2 else len(rw) - 1
    if rw and sum(1 for w in rw if wmatch(w)) >= need:
        return 4
    return 0


def _jac_match(rjac, ejac):
    """Journal acronyms match if one is a prefix of the other ("RPH"/"RP",
    "MLN"/"MLN") — tolerant of the trailing 'h'/journal-word the OCR keeps or drops."""
    if not rjac or not ejac or min(len(rjac), len(ejac)) < 2:
        return False
    n = min(len(rjac), len(ejac))
    return rjac[:n] == ejac[:n]


def _parse_ref(r):
    lead = None
    m = re.match(r"^\*?\[?([A-Za-z0-9À-ÿ][A-Za-z0-9À-ÿ.\-]{0,7})\]?(?:\{\.underline\})?\*?\s*,", r)
    if m:
        lead = m.group(1)
    surs = [s for s in re.findall(r"[A-ZÀ-Þ][A-ZÀ-Þ'\-]{2,}", r)
            if _sigkey(s) not in _JOURNAL_STOP]
    vm = re.search(r"\b(" + _ROMAN + r")\s*,\s*(\d+)", r)
    vol = vm.group(1) if vm else None
    page = int(vm.group(2)) if vm else None
    if page is None:
        pm = re.search(r",\s*p?\.?\s*(\d+)", r)
        page = int(pm.group(1)) if pm else None
    jm = (re.search(r"\[([A-Za-z.]{2,8})\]\{\.underline\}", r)
          or re.search(r"\*([A-Z][A-Za-z.]{1,7})\*", r)
          or re.search(r",\s*([A-Z][A-Za-z.]{2,8})\s*,\s*" + _ROMAN, r))
    rjac = _sigkey(jm.group(1)) if jm else ""
    tm = re.search(r"\*([^*]+)\*", r)
    rtitle = _deaccent(tm.group(1)).lower().strip(" .") if tm else ""
    return lead, surs, vol, page, rjac, rtitle


# a trailing physical-extent clause ("6 vols." / "244 pp." / "XVI + 680 pp." /
# "CLXV + 258 pages") — superseded by the specific locus we append.
_EXTENT = re.compile(
    r"[,;]?\s*\(?(?:(?:[IVXLCDM]+\s*\+\s*)?\d+\s*(?:vols?|pp|p|pages?|coll?|col)\.?"
    r"|pp?\.\s*\d+)\)?\.?\s*$",
    re.I)


def _append_locus(cite, vol, page):
    """A terse ref into a book/anthology carries the specific volume+page it means
    ("Choix, II, 248"). Append it as ', vol. II, p. 248' / ', p. 45', dropping the
    entry's trailing extent (which the specific locus supersedes)."""
    c = cite.rstrip().rstrip(".")
    m = _EXTENT.search(c)
    if m:
        c = c[:m.start()].rstrip(" ,;")
    loc = []
    if vol:
        loc.append("vol. " + vol)
    if page is not None:
        loc.append("p. " + str(page))
    return c + (", " + ", ".join(loc) if loc else "")


def _resolve_ref(raw, prev_sur, prev_entry):
    """Return (full_citation_or_None, author_key, entry). A ref that points INTO a
    book/anthology gets its specific volume+page appended; a ref to a journal
    article whose page-range the entry already states does not."""
    r = raw.strip()
    is_id = bool(re.match(r"^(?:id\.|ibid\.|idem)", r, re.I))
    id_ref = is_id and prev_sur
    lead, surs, vol, page, rjac, rtitle = _parse_ref(r)
    anth_key = "PARNOCC" if re.search(r"parn\.?\s*occ", _deaccent(r).lower()) else None

    # "id., II, 42" — an id-ref carrying NO title of its own is the SAME WORK as
    # the previous reference, only a different volume/page ("F. GENNRICH,
    # *Musikalische…*, I, 47. id., II, 42." → the same Nachlass, vol. II, p. 42).
    if is_id and not rtitle and prev_entry is not None:
        cite = prev_entry["text"]
        in_range = page is not None and any(lo <= page <= hi for (_, lo, hi) in prev_entry["pts"])
        if not in_range:
            cite = _append_locus(cite, vol, page)
        return cite, prev_sur, prev_entry

    best, best_sur = None, prev_sur
    # 1. work-siglum ref (RO, RvO, PAT, TOB, LR…)
    if lead:
        e = _by_sig.get(_sigkey(lead))
        if e:
            best = e
            best_sur = _surkey(e["author"].split(",")[0]) if e["author"] else prev_sur
    # 2. anthology siglum (Choix, MW, Parn. Occ…)
    if best is None and (lead or anth_key):
        anth = (_ANTHOLOGY.get(_sigkey(lead)) if lead else None) \
            or (_ANTHOLOGY.get(anth_key) if anth_key else None)
        if anth:
            for e in _by_sur.get(anth[0], []):
                if anth[1] in e["etitle"] or anth[1] in _deaccent(e["text"]).lower():
                    best, best_sur = e, anth[0]
                    break
    # 3. author + journal/volume/page or title
    if best is None:
        if id_ref:
            cand_surs = [id_ref]
        else:
            cand_surs = []
            for s in surs:                       # split compound "NELLI-LAVAUD" surnames
                for part in [s] + s.split("-"):
                    k = _surkey(part)
                    if k and k not in cand_surs:
                        cand_surs.append(k)
            # the leading token before the first comma is often a title-case
            # surname ("Bartsch, *Chrest.*", "Beck, *Melodien*") the all-caps
            # scan misses; try it as a surname too
            if lead and len(lead) > 2 and _surkey(lead) not in cand_surs:
                cand_surs.append(_surkey(lead))
        bestscore = 0
        for sk in cand_surs:
            cands = _by_sur.get(sk, [])
            for e in cands:
                score = _title_score(rtitle, e["etitle"])
                for (v, lo, hi) in e["pts"]:
                    sc = 2 if vol and v == vol else 0
                    if page is not None and lo <= page <= hi:
                        # a terse ref that cites an article's FIRST page (page == lo
                        # of a real range) is a strong, precise match
                        sc += 3 if (page == lo and hi > lo) else 2
                    if sc:
                        score = max(score, sc + (1 if _jac_match(rjac, e["jac"]) else 0))
                if len(cands) == 1 and score < 3:
                    score = max(score, 3)
                if score > bestscore:
                    best, bestscore, best_sur = e, score, sk
        if bestscore < 3:
            best = None

    if best is None:
        return None, prev_sur, prev_entry
    # append the specific locus unless the entry itself already states a page range
    # that contains the ref's page (i.e. it is a self-contained article citation).
    cite = best["text"]
    in_range = page is not None and any(lo <= page <= hi for (_, lo, hi) in best["pts"])
    if not in_range:
        cite = _append_locus(cite, vol, page)
    return cite, best_sur, best


def _split_refs(blob):
    parts = re.split(r"(?<=[0-9)\]])\s*\.\s+", blob.strip())
    return [p.strip().rstrip(".").strip() for p in parts if p.strip()]


# a manuscript line opens on its witness siglum ("D :", "*I* :", "M^o^ :", "a :")
_MS_SPLIT = re.compile(r"(?=(?:\*?[A-Za-z]\^?[a-z0-9]*\^?\*?)\s*:)")


def _split_ms(blob):
    parts = [p.strip() for p in _MS_SPLIT.split(blob.strip()) if p.strip()]
    return parts or ([blob.strip()] if blob.strip() else [])


for c in par_chanson:
    c["manuscrits_lines"] = _split_ms(c["manuscrits"])
    for field in ("editions", "etudes"):
        resolved, prev_sur, prev_entry = [], None, None
        for blob in c[field]:
            for raw in _split_refs(blob):
                cite, prev_sur, prev_entry = _resolve_ref(raw, prev_sur, prev_entry)
                resolved.append({"raw": raw, "cite": cite})
                if cite is None:
                    pc_flags.append((c["chanson"], raw))
        c[field] = resolved

out = {"sections": tree, "general": general, "raimbaut": raimbaut,
       "par_chanson": par_chanson}
json.dump(out, open("bibliography.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

with open("bibliography-flags.md", "w", encoding="utf-8") as f:
    f.write("# Bibliography flags — OCR-damaged / ambiguous entries (manual review)\n\n")
    f.write(f"{len(flags)} entries left as-is (conservative repair). Quote delimiters "
            "could not be safely closed/converted; fix by hand in the source "
            "(`corpus/`) if desired, then re-run `build_bibliography.py`.\n\n")
    f.write("| printed p. | issue | entry (author: text…) |\n|---|---|---|\n")
    for pg, kind, txt in flags:
        f.write(f"| {pg} | {kind} | {txt.replace('|', '\\|')} |\n")
    f.write("\n## Par-chanson references left unresolved\n\n")
    f.write(f"{len(pc_flags)} terse per-chanson references could not be matched to a "
            "full catalogued entry (OCR garble, or a work catalogued nowhere in the "
            "bibliography). They render verbatim. Fix the source (`corpus/`) or add "
            "the work, then re-run.\n\n")
    f.write("| chanson | terse reference |\n|---|---|\n")
    for ch, ref in pc_flags:
        f.write(f"| {ch} | {ref.replace('|', '\\|')} |\n")

n_rev = sum(len(x["reviews"]) for x in general + raimbaut)
n_pc_refs = sum(len(c["editions"]) + len(c["etudes"]) for c in par_chanson)
n_pc_res = sum(1 for c in par_chanson for r in c["editions"] + c["etudes"] if r["cite"])
print(f"general entries: {len(general)}   raimbaut entries: {len(raimbaut)}   "
      f"reviews nested: {n_rev}   par-chanson blocks: {len(par_chanson)}   flags: {len(flags)}")
print(f"par-chanson refs: {n_pc_res}/{n_pc_refs} resolved   ({len(pc_flags)} flagged)")


def show_tree(nodes, depth=0):
    for n in nodes:
        cnt = sum(1 for x in general + raimbaut if x["section"] == n["id"])
        print("  " * (depth + 1) + f"{n['label']}. {n['title']}  [{n['id']}]"
              + (f"  ({cnt} entries)" if cnt else ""))
        show_tree(n.get("children") or [], depth + 1)


print("tree:")
show_tree(tree)
unsectioned = [x for x in general + raimbaut if not x["section"]]
if unsectioned:
    print(f"!! {len(unsectioned)} entries with no section")
print("sample raimbaut (w/ sigla + reviews):")
for x in raimbaut:
    if x["siglum"] or x["reviews"]:
        print(f"  [{x['siglum'] or '-'}] {x['author'][:20]:20} {x['title'][:36]:36} "
              f"reviews: {len(x['reviews'])}")
print("par-chanson chansons:", [c["chanson"] for c in par_chanson][:12], "...")
print("par-chanson with études:", sum(1 for c in par_chanson if c["etudes"]))
