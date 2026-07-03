"""
Harvest a consolidated bibliography from the footnote apparatus.

Full citations in this thesis follow a stable shape inside footnote definitions:

    [Prénom(s)/Initiales] NOM(S), *Titre*[, dans *Revue*], Lieu, Éditeur, Année, pp.

The surname is ALL-CAPS (the thesis convention), which is the reliable hook: we
scan every footnote definition, in reading order, for "AUTHOR, *Title*" and
record each as a citation occurrence. Occurrences are then deduplicated by
(surname-key, title-key) into bibliography entries, keeping the fullest snippet
and the first page of appearance.

This is Phase 1 of the reference apparatus: the target list that sigla and
back-references (op. cité / ibid. / …) will later resolve *to*. Output:
  bibliography.json  { entries[], occurrences[] }
Run it, eyeball the entries, tighten the regex, repeat.
"""

import json
import re
import unicodedata
from pathlib import Path

MANIFEST = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
OUT = Path("bibliography.json")

DEF_LINE = re.compile(r"^\[\^([^\]]+)\]:\s*(.*)", re.M)

# An author: optional given names / initials (Title-case words or "X."),
# then one or more ALL-CAPS surname tokens, optionally joined by et/de/von/di,
# immediately followed by ", *Title*".
CAP = r"[A-ZÀ-ÖØ-Þ]"
LOW = r"[a-zà-öø-ÿ]"
GIVEN = rf"(?:{CAP}(?:{LOW}+|\.)\s+|{CAP}\.-?{CAP}?\.?\s+)*"
SURNAME = rf"{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\.\-]+"
AUTHOR = rf"{GIVEN}{SURNAME}(?:(?:\s+(?:et|E\.|and)\s+|\s*,\s*)?{GIVEN}{SURNAME})*"
# title may be *italic* (books) or "quote-wrapped" (articles, often with inner italics)
CITATION = re.compile(rf'(?P<author>{AUTHOR}|ID\.|Id\.)\s*,\s*'
                      rf'(?:\*(?P<t1>[^*]+)\*|"(?P<t2>[^"]{{4,}})")')
SIGLA = set(json.loads(Path("citations.json").read_text(encoding="utf-8")).get("abbreviations", []) and
            [a["siglum"] for a in json.loads(Path("citations.json").read_text(encoding="utf-8"))["abbreviations"]])

BACKREF = re.compile(r"\b(?:op\.?\s*cit|ouv\.?\s*cit|art\.?\s*cit|loc\.?\s*cit|ibid)", re.I)
# a "title" that is really a back-reference phrase (author named, work implicit)
BACKREF_TITLE = re.compile(r"^\s*(?:op|ouv|art|loc)\.?\s*cit|^\s*ibid", re.I)
# connectors that get swept into the author capture and must be stripped
LEAD = re.compile(r"^(?:voir\s+aussi\s+|voir\s+|cfr\.?\s+|cf\.\s+|e\.a\.\s+|"
                  r"dans\s+|chez\s+|see\s+|aussi\s+|selon\s+|d'après\s+)+", re.I)


def keyify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def surname_key(author):
    caps = re.findall(rf"\b{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\-]+", author)
    return keyify(caps[0]) if caps else keyify(author.split()[-1])


occurrences = []
entries = {}   # (surname_key, title_key) -> entry
last_author = None   # for "ID." (idem) = same author as the previous citation

for m in MANIFEST:
    page = m["label"]
    text = Path(m["file"]).read_text(encoding="utf-8")
    for dm in DEF_LINE.finditer(text):
        note, body = dm.group(1), dm.group(2)
        # record citations
        for cm in CITATION.finditer(body):
            author = LEAD.sub("", re.sub(r"\s+", " ", cm.group("author")).strip(" ,"))
            title = re.sub(r"\s+", " ", (cm.group("t1") or cm.group("t2"))).strip()
            if len(title) < 4:      # skip stray *x* emphasis
                continue
            if author in ("ID.", "Id.", "id."):     # idem = previous author's other work
                author = last_author or author
            elif author in SIGLA:                    # a siglum, not an author
                continue
            else:
                last_author = author
            # "AUTHOR, *op. cité*" is a back-reference naming its author, not a work
            if BACKREF_TITLE.match(title):
                occurrences.append({"page": page, "note": note, "kind": "backref_named",
                                    "author": author, "surname_key": surname_key(author),
                                    "phrase": title})
                continue
            sk, tk = surname_key(author), keyify(title)[:40]
            occurrences.append({"page": page, "note": note, "kind": "full",
                                 "author": author, "title": title})
            key = (sk, tk)
            snippet = re.sub(r"\s+", " ", body[cm.start():cm.start() + 240]).strip()
            if key not in entries:
                entries[key] = {"id": f"{sk}-{tk}"[:48], "author": author,
                                "title": title, "surname_key": sk,
                                "first_page": page, "snippet": snippet, "count": 0}
            entries[key]["count"] += 1
            # keep the longest given-name form seen
            if len(author) > len(entries[key]["author"]):
                entries[key]["author"] = author
        # bare back-references (no author named right before the cit-phrase):
        # count phrase hits, minus the ones already captured as backref_named here
        named_here = sum(1 for o in occurrences
                         if o.get("page") == page and o.get("note") == note
                         and o["kind"] == "backref_named")
        total_here = len(BACKREF.findall(body))
        for _ in range(max(0, total_here - named_here)):
            occurrences.append({"page": page, "note": note, "kind": "backref_bare",
                                "snippet": re.sub(r"\s+", " ", body)[:120]})

bib = sorted(entries.values(), key=lambda e: (e["surname_key"], -e["count"]))

OUT.write_text(json.dumps({"entries": bib, "occurrences": occurrences},
                          ensure_ascii=False, indent=2), encoding="utf-8")

full = [o for o in occurrences if o["kind"] == "full"]
named = [o for o in occurrences if o["kind"] == "backref_named"]
bare = [o for o in occurrences if o["kind"] == "backref_bare"]
print(f"{len(bib)} distinct works, from {len(full)} full-citation occurrences")
print(f"back-references: {len(named)} author-named (easy) + {len(bare)} bare (ibid.-type)")
print("\n— most-cited works —")
for e in sorted(bib, key=lambda e: -e["count"])[:18]:
    print(f"  {e['count']:3}×  {e['author'][:30]:30}  {e['title'][:48]}")
print("\n— named back-refs by author (Phase-2 resolvable) —")
from collections import Counter
c = Counter(o["surname_key"] for o in named)
print("  " + ", ".join(f"{k}({n})" for k, n in c.most_common(12)))
