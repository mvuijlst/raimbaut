"""
Back-reference apparatus for the 2026 edition -> references.json.

Resolves every op./ouv./art./loc. cité and ibid. in the footnotes to the work
it points at, so the site can hyperlink it. Consumes corpus (manifest.json,
pageid IDs), citations.json (sigla to skip), and — new for v2 — bibliography.json
as a fallback antecedent set: an author-named back-reference whose full citation
never appeared in a prior footnote can still resolve to that author's real
bibliography entry.

Method — one reading-order pass over footnote defs, maintaining:
  * by_author[surname] -> most recent FULL footnote citation for that author
  * last_full          -> most recent full footnote citation (for bare ibid.)
  * bib_by_author      -> the author's bibliography entry (static fallback)

  named ("ROTH, *art. cité*"): footnote by_author first (high if author has one
      work so far, else medium), else bibliography (high if one bib work, else
      medium, source=bibliography), else unresolved.
  bare ("*ibid.*"): last_full (medium; ibid. is only as good as note ordering).

Output: references.json { stats, resolved[], unresolved[] } — presentation-
agnostic targets (author/title/page/note[/source]).
"""
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

MANIFEST = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
BIB = json.loads(Path("bibliography.json").read_text(encoding="utf-8"))
SIGLA = {a["siglum"] for a in json.loads(Path("citations.json").read_text(encoding="utf-8"))["abbreviations"]}
OUT = Path("references.json")

CAP, LOW = r"[A-ZÀ-ÖØ-Þ]", r"[a-zà-öø-ÿ]"
GIVEN = rf"(?:{CAP}(?:{LOW}+|\.)\s+|{CAP}\.-?{CAP}?\.?\s+)*"
SURNAME = rf"{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\.\-]+"
AUTHOR = rf"{GIVEN}{SURNAME}(?:(?:\s+(?:et|E\.|and)\s+|\s*,\s*)?{GIVEN}{SURNAME})*"
DEF_LINE = re.compile(r"^\[\^([^\]]+)\]:\s*(.*)", re.M)
CITATION = re.compile(rf'(?P<author>{AUTHOR}|ID\.|Id\.)\s*,\s*'
                      rf'(?:\*(?P<t1>[^*]+)\*|"(?P<t2>[^"]{{4,}})"|\'(?P<t3>[^\']{{4,}})\')')
BACKREF = re.compile(r"(?:op\.?\s*cit|ouv\.?\s*cit|art\.?\s*cit|loc\.?\s*cit|ibid)\.?", re.I)
BACKREF_TITLE = re.compile(r"^\s*(?:op|ouv|art|loc)\.?\s*cit|^\s*ibid", re.I)
LEAD = re.compile(r"^(?:voir\s+aussi\s+|voir\s+|cfr\.?\s+|cf\.\s+|e\.a\.\s+|dans\s+|"
                  r"chez\s+|see\s+|aussi\s+|selon\s+|d'après\s+)+", re.I)
ROMAN = re.compile(r"^[IVXLCDM]+$")
SURTOK = re.compile(rf"\b{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\-]+\b")


def keyify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def surname_key(author):
    caps = re.findall(rf"\b{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\-]+", author)
    return keyify(caps[0]) if caps else keyify(author.split()[-1] if author.split() else author)


# ---- bibliography fallback: surname_key -> entry, + work count for confidence
bib_by_author = {}
bib_work_count = Counter()
for section in ("general", "raimbaut"):
    for e in BIB[section]:
        if not e["author"]:
            continue
        sk = surname_key(e["author"])
        bib_work_count[sk] += 1
        bib_by_author.setdefault(sk, {"author": e["author"], "title": e["title"],
                                      "page": e["page"], "source": "bibliography",
                                      "section": section})

by_author = {}       # surname_key -> {author,title,page,note}  (footnote full cites)
author_works = {}    # surname_key -> set of title keys (ambiguity gauge)
mention = {}         # surname_key -> {page,note} last note naming the author at all
last_full = None
resolved, unresolved = [], []

for m in MANIFEST:
    page = m["pageid"]
    text = Path(m["file"]).read_text(encoding="utf-8")
    for dm in DEF_LINE.finditer(text):
        note, body = dm.group(1), dm.group(2)
        events, cit_spans = [], []
        for cm in CITATION.finditer(body):
            author = LEAD.sub("", re.sub(r"\s+", " ", cm.group("author")).strip(" ,"))
            title = re.sub(r"\s+", " ", (cm.group("t1") or cm.group("t2") or cm.group("t3"))).strip()
            cit_spans.append((cm.start(), cm.end()))
            if BACKREF_TITLE.match(title):
                events.append((cm.start(), "named", author))
            elif len(title) >= 4:
                events.append((cm.start(), "full", (author, title)))
        for bm in BACKREF.finditer(body):
            if not any(s <= bm.start() < e for s, e in cit_spans):
                events.append((bm.start(), "bare", bm.group(0)))
        events.sort()

        for pos, typ, payload in events:
            if typ == "full":
                author, title = payload
                if author in ("ID.", "Id.", "id."):
                    author = last_full["author"] if last_full else author
                if author in SIGLA:
                    continue
                sk = surname_key(author)
                rec = {"author": author, "title": title, "page": page, "note": note}
                by_author[sk] = rec
                author_works.setdefault(sk, set()).add(keyify(title)[:40])
                last_full = rec
            elif typ == "named":
                author = payload
                if author in SIGLA or author.rstrip(".") in SIGLA:
                    continue    # a siglum + "cité"/page, not an author back-reference
                sk = surname_key(author)
                item = {"page": page, "note": note, "kind": "named",
                        "phrase": payload, "author": author}
                tgt = by_author.get(sk)
                if tgt:
                    item.update(target=tgt, confidence=(
                        "high" if len(author_works.get(sk, set())) <= 1 else "medium"))
                    last_full = tgt
                    resolved.append(item)
                elif sk in bib_by_author:
                    item.update(target=bib_by_author[sk], confidence=(
                        "high" if bib_work_count[sk] <= 1 else "medium"),
                        note_hint="resolved via bibliography (not previously cited in a footnote)")
                    resolved.append(item)
                elif sk in mention:
                    item.update(target={"author": author, "title": "(reference on this page)",
                                        **mention[sk]}, confidence="low",
                                loose="points to prior mention; full citation not parsed")
                    resolved.append(item)
                else:
                    item["reason"] = "author not previously cited"
                    unresolved.append(item)
            else:  # bare ibid.-type
                item = {"page": page, "note": note, "kind": "bare", "phrase": payload}
                if last_full:
                    item.update(target=last_full, confidence="medium")
                    resolved.append(item)
                else:
                    item["reason"] = "no antecedent full citation"
                    unresolved.append(item)

        for tok in SURTOK.findall(body):
            if tok not in SIGLA and not ROMAN.match(tok):
                mention[surname_key(tok)] = {"page": page, "note": note}

stats = {
    "resolved": len(resolved), "unresolved": len(unresolved),
    "high_conf": sum(1 for r in resolved if r.get("confidence") == "high"),
    "medium_conf": sum(1 for r in resolved if r.get("confidence") == "medium"),
    "low_conf": sum(1 for r in resolved if r.get("confidence") == "low"),
    "via_bibliography": sum(1 for r in resolved if r.get("target", {}).get("source") == "bibliography"),
}
OUT.write_text(json.dumps({"stats": stats, "resolved": resolved, "unresolved": unresolved},
                          ensure_ascii=False, indent=2), encoding="utf-8")

print(f"resolved: {stats['resolved']}  (high {stats['high_conf']}, medium {stats['medium_conf']}, "
      f"low/loose {stats['low_conf']}; {stats['via_bibliography']} via bibliography)")
print(f"unresolved: {stats['unresolved']}")
print("unresolved by author:",
      ", ".join(f"{k}({n})" for k, n in Counter(surname_key(u.get('author', '')) or 'ibid'
                for u in unresolved).most_common(12)))
print("\n— sample resolutions —")
for r in resolved[:12]:
    t = r["target"]
    src = "B" if t.get("source") == "bibliography" else " "
    print(f" {src}{r['page']}/{r['note']:>4} {r['phrase'][:9]:9}[{r['kind']:5} {r.get('confidence',''):6}]"
          f" -> {t['author'][:22]:22} {t['title'][:30]} ({t['page']})")
