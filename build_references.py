"""
Phase 2 of the reference apparatus: resolve every back-reference
(op. cité / ouv. cité / art. cité / loc. cit. / ibid.) to the antecedent it
points at, so the web edition can hyperlink it.

Method — one pass over the footnote definitions in reading order, maintaining:
  * by_author[surname]  -> the most recent FULL citation seen for that author
  * last_full           -> the most recent full citation, any author (for ibid.)

For each back-reference:
  * author-named ("ROTH, *art. cité*")  -> that author's most-recent full cite.
      confidence = high if the author has exactly one work so far, else medium
      (we pick the most recent — the usual scholarly reading — and flag it).
  * bare ("*ibid.*", "voir *op. cit.*") -> last_full (positional).
      confidence = medium; ibid. is only as good as the note ordering.
Anything with no antecedent (author never previously cited in full) is recorded
as unresolved with its author, for a manual pass.

Output: references.json { resolved[], unresolved[], stats } — presentation-
agnostic (targets identified by author/title/page/note), for the site to link.
"""

import json
import re
import unicodedata
from pathlib import Path

MANIFEST = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
OUT = Path("references.json")

CAP, LOW = r"[A-ZÀ-ÖØ-Þ]", r"[a-zà-öø-ÿ]"
GIVEN = rf"(?:{CAP}(?:{LOW}+|\.)\s+|{CAP}\.-?{CAP}?\.?\s+)*"
SURNAME = rf"{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\.\-]+"
AUTHOR = rf"{GIVEN}{SURNAME}(?:(?:\s+(?:et|E\.|and)\s+|\s*,\s*)?{GIVEN}{SURNAME})*"
DEF_LINE = re.compile(r"^\[\^([^\]]+)\]:\s*(.*)", re.M)
CITATION = re.compile(rf'(?P<author>{AUTHOR}|ID\.|Id\.)\s*,\s*'
                      rf'(?:\*(?P<t1>[^*]+)\*|"(?P<t2>[^"]{{4,}})")')
BACKREF = re.compile(r"(?:op\.?\s*cit|ouv\.?\s*cit|art\.?\s*cit|loc\.?\s*cit|ibid)\.?", re.I)
BACKREF_TITLE = re.compile(r"^\s*(?:op|ouv|art|loc)\.?\s*cit|^\s*ibid", re.I)
LEAD = re.compile(r"^(?:voir\s+aussi\s+|voir\s+|cfr\.?\s+|cf\.\s+|e\.a\.\s+|dans\s+|"
                  r"chez\s+|see\s+|aussi\s+|selon\s+|d'après\s+)+", re.I)
SIGLA = {a["siglum"] for a in json.loads(Path("citations.json").read_text(encoding="utf-8"))["abbreviations"]}


def keyify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def surname_key(author):
    caps = re.findall(rf"\b{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\-]+", author)
    return keyify(caps[0]) if caps else keyify(author.split()[-1] if author.split() else author)


by_author = {}       # surname_key -> {author,title,page,note}  (clean full citations)
author_works = {}    # surname_key -> set of title keys seen (ambiguity gauge)
mention = {}         # surname_key -> {page,note} last note that names the author at all
last_full = None
resolved, unresolved = [], []
last_author = None
ROMAN = re.compile(r"^[IVXLCDM]+$")
SURTOK = re.compile(rf"\b{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\-]+\b")

for m in MANIFEST:
    page = m["label"]
    text = Path(m["file"]).read_text(encoding="utf-8")
    for dm in DEF_LINE.finditer(text):
        note, body = dm.group(1), dm.group(2)
        # ---- build ordered events for this note ----
        events = []   # (pos, type, payload)
        cit_spans = []
        for cm in CITATION.finditer(body):
            author = LEAD.sub("", re.sub(r"\s+", " ", cm.group("author")).strip(" ,"))
            title = re.sub(r"\s+", " ", (cm.group("t1") or cm.group("t2"))).strip()
            cit_spans.append((cm.start(), cm.end()))
            if BACKREF_TITLE.match(title):
                events.append((cm.start(), "named", author))
            elif len(title) >= 4:
                events.append((cm.start(), "full", (author, title)))
        for bm in BACKREF.finditer(body):
            if not any(s <= bm.start() < e for s, e in cit_spans):   # not the named case
                events.append((bm.start(), "bare", bm.group(0)))
        events.sort()

        # ---- walk events in order, resolving as we go ----
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
                last_author = author
            elif typ == "named":
                author = payload
                sk = surname_key(author)
                tgt = by_author.get(sk)
                item = {"page": page, "note": note, "kind": "named",
                        "phrase": payload, "author": author}
                if tgt:
                    item.update(target=tgt, confidence=(
                        "high" if len(author_works.get(sk, set())) <= 1 else "medium"))
                    last_full = tgt
                    resolved.append(item)
                elif sk in mention:
                    # full citation not cleanly parsed, but the author is named in a
                    # prior note (e.g. a quote-titled or OCR-garbled reference) -> link there
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

        # record author mentions from this note (for the loose fallback above);
        # done after resolving so a note's back-refs only see prior notes' mentions
        for tok in SURTOK.findall(body):
            if tok not in SIGLA and not ROMAN.match(tok):
                mention[surname_key(tok)] = {"page": page, "note": note}

stats = {
    "resolved": len(resolved),
    "unresolved": len(unresolved),
    "high_conf": sum(1 for r in resolved if r.get("confidence") == "high"),
    "medium_conf": sum(1 for r in resolved if r.get("confidence") == "medium"),
    "low_conf": sum(1 for r in resolved if r.get("confidence") == "low"),
}
OUT.write_text(json.dumps({"stats": stats, "resolved": resolved, "unresolved": unresolved},
                          ensure_ascii=False, indent=2), encoding="utf-8")

print(f"resolved: {stats['resolved']}  (high {stats['high_conf']}, medium {stats['medium_conf']}, low/loose {stats['low_conf']})")
print(f"unresolved: {stats['unresolved']}")
from collections import Counter
print("unresolved by author:",
      ", ".join(f"{k}({n})" for k, n in Counter(surname_key(u.get('author', '')) or 'ibid'
                for u in unresolved).most_common(12)))
print("\n— sample resolutions —")
for r in resolved[:10]:
    t = r["target"]
    print(f"  {r['page']}/{r['note']:>4} {r['phrase'][:9]:9} [{r['kind']:5} {r.get('confidence',''):6}] -> "
          f"{t['author'][:22]}, {t['title'][:34]} ({t['page']})")
