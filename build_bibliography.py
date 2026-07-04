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
# a line that OPENS a new author entry: "SURNAME, Given[, work…]"
NEWAUTHOR = re.compile(rf"^(?P<sur>{SURNAME})\s*,\s*(?P<rest>.*)$")
TITLE = re.compile(r"\*(?P<t1>[^*]+)\*|'(?P<t2>[^']{4,})'")
JOURNAL = re.compile(r"(?:dans|ds\.?|in)\s+\*(?P<j>[^*]+)\*", re.I)
IBIDJ = re.compile(r"\*?\bibid\.?\*?", re.I)
CHANSON_HDR = re.compile(r"^\*?CHANSON\s+([IVXL]+)\*?\s*$")
HEADING = re.compile(r"^([IVX]+\.|[A-Z]\.|\d+\.)\s")


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
par_chanson = []      # {chanson, manuscrits, editions[]}
cur = None            # per-chanson accumulator
flags = []            # (printed, kind, text) — OCR-damaged / ambiguous, for review

# order pages: bibliography start .. first index
bib_pages = [e for e in pages if e["printed"].isdigit() and 470 <= int(e["printed"]) <= 554]


def entry_sink(printed):
    return raimbaut if 512 <= printed <= 515 else general


# general / raimbaut: ONE entry per work, author carried forward across the blank /
# dash left-column continuations the two-column typescript OCR'd into bare lines.
cur_author = None     # "SURNAME, Given" display prefix
cur_surname = ""      # SURNAME only (downstream keying: build_citations_v2)
cur_journal = None    # last journal cited by the current author (for ibid.)


def split_author_work(rest):
    """rest = 'Given, work…' -> (given, work). Given = field up to the next comma."""
    parts = rest.split(",", 1)
    return parts[0].strip(), (parts[1].strip() if len(parts) > 1 else "")


def emit_work(author_display, surname, work, printed, author_sig=""):
    global cur_journal
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
    sm = SIGLUM.search(work)
    sig = (sm.group(1) or sm.group(2)) if sm else ""
    if not looks_like_siglum(sig):
        sig = ""
    sig = author_sig or sig   # an underlined author-surname siglum takes precedence
    cat = "raimbaut" if 512 <= printed <= 515 else "general"
    entry_sink(printed).append({"author": surname, "title": title, "siglum": sig,
                                "text": f"{author_display}, {work}".strip(),
                                "page": printed, "category": cat})


for e in bib_pages:
    printed = int(e["printed"])
    if printed >= 516:
        # ---- par chanson (B): unchanged Manuscrits / Éditions accumulation -----
        for ln in body_lines(e):
            s = ln.strip()
            if not s:
                continue
            ch = CHANSON_HDR.match(s)
            if ch:
                cur = {"chanson": ch.group(1), "manuscrits": "", "editions": []}
                par_chanson.append(cur); continue
            if cur is None:
                continue
            if re.match(r"^1\.\s*Manuscrits", s):
                cur["_mode"] = "ms"; continue
            if re.match(r"^2\.\s*[EÉ]ditions", s):
                cur["_mode"] = "ed"; continue
            if cur.get("_mode") == "ms":
                cur["manuscrits"] += (" " if cur["manuscrits"] else "") + s
            elif cur.get("_mode") == "ed":
                cur["editions"].append(s)
        continue
    # ---- general / raimbaut: one entry per work -------------------------------
    for ln in body_lines(e):
        s = ln.strip()
        if not s:
            continue
        # section / subsection heading (I. / A. / 1. / *Titre*) breaks the author run
        if HEADING.match(s) or (s.startswith("*") and s.endswith("*") and s.count("*") == 2):
            cur_author, cur_surname, cur_journal = None, "", None
            continue
        bulleted = s.startswith("- ")
        body = s[2:].strip() if bulleted else s
        # a "C.R. par X" compte-rendu note -> a review of the current author's work;
        # attach it to that author rather than minting a garbage author, and flag it.
        if REVIEW.match(re.sub(r"^\[([^\]]+)\]\{\.underline\}", r"\1", body)):
            if cur_author:
                emit_work(cur_author, cur_surname, body, printed)
            flags.append((printed, "review note (C.R.) attached to current author", body[:90]))
            continue
        # A bullet ALWAYS opens a new author (left-column entry). A non-bulleted line
        # opens one only if it clearly starts with SURNAME, Given (a review); otherwise
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

out = {"general": general, "raimbaut": raimbaut, "par_chanson": par_chanson}
json.dump(out, open("bibliography.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

with open("bibliography-flags.md", "w", encoding="utf-8") as f:
    f.write("# Bibliography flags — OCR-damaged / ambiguous entries (manual review)\n\n")
    f.write(f"{len(flags)} entries left as-is (conservative repair). Quote delimiters "
            "could not be safely closed/converted; fix by hand in the source "
            "(`corpus/`) if desired, then re-run `build_bibliography.py`.\n\n")
    f.write("| printed p. | issue | entry (author: text…) |\n|---|---|---|\n")
    for pg, kind, txt in flags:
        f.write(f"| {pg} | {kind} | {txt.replace('|', '\\|')} |\n")

print(f"general entries: {len(general)}   raimbaut entries: {len(raimbaut)}   "
      f"par-chanson blocks: {len(par_chanson)}   flags: {len(flags)}")
print("sample general:")
for x in general[:4]:
    print(f"  {x['author'][:22]:22} | {x['title'][:48]}")
print("sample raimbaut (w/ sigla):")
for x in raimbaut:
    if x["siglum"]:
        print(f"  [{x['siglum']}] {x['author'][:20]:20} {x['title'][:40]}")
print("par-chanson chansons:", [c["chanson"] for c in par_chanson][:12], "...")
