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
    (+ by_author_initial["surname|initial"]: Edward L. ADAMS is not George C.S. ADAMS)
  * last_full          -> the ANTECEDENT: the work most recently referred to, with
                          the locator it was cited at. Everything that refers to a
                          work moves it — a full citation, a named back-reference,
                          a siglum citation ("[RO]{.underline}, p.92"), a short-title
                          citation ("*Razos*..., p.18"), a cross-reference to the
                          thesis itself ("voir *supra*, p.120"), and an ibid. that
                          carries its own page ("Ibid., p.117").
  * bib_by_author      -> the author's bibliography entry (static fallback)

  named ("ROTH, *art. cité*" — also unitalicised: "J.H. MARSHALL, [art. cité]{.underline}",
      "H.LAUSBERG, ouv.cité"): footnote by_author first (high if author has one work
      so far, else medium), else bibliography, else unresolved.
  bare ibid.: last_full — "the same work, at the same place" — so its target carries
      the antecedent's "locator", which the reading view prints.
  bare op./art./loc. cité (no author right before it): the nearest author NAMED
      earlier in the same note, in any case ("Lewent traduit par … (art.cité, p.608)",
      "von Wartburg … (loc. cit.)" = FEW), else last_full.

Output: references.json { stats, resolved[], unresolved[] } — presentation-
agnostic targets (author/title/page/note[/source][/siglum][/internal][/locator]).
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
# (initials may be glued to the surname: "Edward L.ADAMS", "N.DU PUITSPELU")
GIVEN = rf"(?:{CAP}{LOW}+\s+|{CAP}\.\s*|{CAP}\.-?{CAP}?\.?\s*)*"
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
# A locator as the typescript writes them: "p.92", "pp.298-299", "t.III, p.335", "pp. 65ss."
LOCATOR = re.compile(r"(?:t\.\s*[IVXLC]+\s*,\s*)?pp?\.\s*\d+(?:\s*[-–]\s*\d+)?(?:\s*(?:ss|sv|sq)\.?)?")
SURTOK = re.compile(rf"\b{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\-]+\b")
# "[RO]{.underline}, p.92" · "*GOD*, t.VIII, pp.298-299" · "SW, t.III, p.335": a work cited
# by its siglum. It is an antecedent like any other — an "Ibid." that follows it means
# that work, at that place — so it must move `last_full` (it used not to: such an ibid
# resolved to whatever FULL citation happened to precede, i.e. to the wrong work).
SHORT_TITLE_CITE = re.compile(r"(?:^|[;(]\s*|\bvoir\s+(?:aussi\s+)?)\*([^*]{4,40})\*(?:\s*\.\.\.)?\s*,\s*(?=(?:t\.|pp?\.))", re.I)
INTERNAL_CITE = re.compile(r"\*?(supra|infra)\*?\s*,\s*(?=pp?\.)", re.I)
SIGLUM_CITE = re.compile(
    r"(?:\[(?P<s1>[A-Za-z][A-Za-z.\-]{1,7})\]\{\.underline\}|\*(?P<s2>[A-Z][A-Za-z.\-]{1,7})\*|\b(?P<s3>[A-Z][A-Za-z.\-]{1,7}))"
    r"\s*,?\s*(?=(?:t\.|pp?\.|s\.\s?v\.|col\.|§|\d|\*?(?:loc|op|ouv|art)\.))")


def keyify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def surname_key(author):
    caps = re.findall(rf"\b{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\-]+", author)
    return keyify(caps[0]) if caps else keyify(author.split()[-1] if author.split() else author)


def initial_key(author):
    """surname + first given-name initial ("adams|e"), to tell Edward L. ADAMS from
    George C.S. ADAMS; None when the author is cited by surname alone"""
    m = re.match(rf"\s*({CAP})", author or "")
    sk = surname_key(author)
    first = (author or "").strip().split()[0] if (author or "").strip() else ""
    return f"{sk}|{m.group(1).lower()}" if m and keyify(first) != sk else None


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

SIGLUM_DEF = {a["siglum"]: a for a in json.loads(Path("citations.json").read_text(encoding="utf-8"))["abbreviations"]}


# surname -> siglum, where a surname stands for exactly one siglum work (WARTBURG -> FEW,
# PATTISON -> RO; LEVY is both SW and PDL, so it is left out)
_sig_sur = {}
for _sg, _d in SIGLUM_DEF.items():
    for _tok in re.findall(rf"\b{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\-]+", (_d.get("definition") or _d.get("expansion") or "").split("*")[0]):
        if _tok not in SIGLA:
            _sig_sur.setdefault(keyify(_tok), set()).add(_sg)
SIGLUM_BY_SURNAME = {k: next(iter(v)) for k, v in _sig_sur.items() if len(v) == 1 and len(k) >= 4}


def locator_after(body, start, end):
    """the first locator standing between two reference events (or None)"""
    m = LOCATOR.search(body, start, end)
    return re.sub(r"\s+", " ", m.group(0)).strip() if m else None


by_author = {}       # surname_key -> {author,title,page,note}  (footnote full cites)
by_author_initial = {}   # "surname|initial" -> same, for homonyms
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
            # "LTF et Louis ALIBERT, loc. cit.": a siglum coordinated with an author is
            # not a co-author — the back-reference is the author's
            lead_sig = re.match(r"^(\S+)\s+(?:et|and)\s+(.+)$", author)
            if lead_sig and lead_sig.group(1) in SIGLA:
                author = lead_sig.group(2)
            title = re.sub(r"\s+", " ", (cm.group("t1") or cm.group("t2") or cm.group("t3"))).strip()
            cit_spans.append((cm.start(), cm.end()))
            if BACKREF_TITLE.match(title):
                events.append((cm.start(), "named", author))
            elif len(title) >= 4:
                events.append((cm.start(), "full", (author, title)))
        for bm in BACKREF.finditer(body):
            if any(s <= bm.start() < e for s, e in cit_spans):
                continue
            # "J.H. MARSHALL, [art. cité]{.underline}" / "H.LAUSBERG, ouv.cité": the abbr is
            # neither italic nor quoted, so CITATION missed it — but an author standing
            # right before it makes it a NAMED back-reference all the same
            am = re.search(rf"({AUTHOR})\s*,\s*[\[(*]*$", body[max(0, bm.start() - 90):bm.start()])
            adj = LEAD.sub("", re.sub(r"\s+", " ", am.group(1)).strip(" ,")) if am else None
            if adj and adj not in SIGLA and not bm.group(0).lower().startswith("ibid"):
                events.append((bm.start(), "named", adj))
            else:
                events.append((bm.start(), "bare", bm.group(0)))
        for sm in SIGLUM_CITE.finditer(body):
            sig = sm.group("s1") or sm.group("s2") or sm.group("s3")
            if sig in SIGLA and not any(s <= sm.start() < e for s, e in cit_spans):
                events.append((sm.start(), "siglum", sig))
        # "*Razos*..., p.18." — a work cited by its short title alone. If that title
        # opens a work already cited in full, it is an antecedent too.
        for tm in SHORT_TITLE_CITE.finditer(body):
            if any(s <= tm.start() < e for s, e in cit_spans):
                continue
            tk = keyify(tm.group(1))
            hit = [r for r in by_author.values() if len(tk) >= 5 and keyify(r["title"]).startswith(tk)]
            if len(hit) == 1:
                events.append((tm.start(), "title", hit[0]))
        # "Voir *supra*, pp.414-415." — a cross-reference to the thesis itself
        for xm in INTERNAL_CITE.finditer(body):
            events.append((xm.start(), "internal", xm.group(1).lower()))
        events.sort()
        bounds = [e[0] for e in events] + [len(body)]
        antecedent_pos = -1      # where in THIS note `last_full` was last set (-1: before it)

        for ei, (pos, typ, payload) in enumerate(events):
            loc = locator_after(body, pos, bounds[ei + 1])
            if typ == "siglum":
                d = SIGLUM_DEF[payload]
                last_full = {"author": None, "title": d.get("definition") or d.get("expansion") or payload,
                             "siglum": payload, "page": page, "note": note, "locator": loc}
                antecedent_pos = pos
                continue
            if typ == "title":
                last_full = {**payload, "locator": loc}
                antecedent_pos = pos
                continue
            if typ == "internal":
                last_full = {"author": None, "title": None, "internal": payload,
                             "page": page, "note": note, "locator": loc}
                antecedent_pos = pos
                continue
            if typ == "full":
                author, title = payload
                if author in ("ID.", "Id.", "id."):
                    author = last_full["author"] if last_full else author
                if author in SIGLA:
                    continue
                sk = surname_key(author)
                rec = {"author": author, "title": title, "page": page, "note": note}
                by_author[sk] = rec
                if initial_key(author):
                    by_author_initial[initial_key(author)] = rec
                author_works.setdefault(sk, set()).add(keyify(title)[:40])
                last_full = {**rec, "locator": loc}
                antecedent_pos = pos
            elif typ == "named":
                author = payload
                if author in SIGLA or author.rstrip(".") in SIGLA:
                    continue    # a siglum + "cité"/page, not an author back-reference
                sk = surname_key(author)
                item = {"page": page, "note": note, "kind": "named",
                        "phrase": payload, "author": author}
                # a shared surname: the given-name initial decides, when the note gives one
                tgt = by_author_initial.get(initial_key(author)) or by_author.get(sk)
                if tgt:
                    item.update(target=tgt, confidence=(
                        "high" if len(author_works.get(sk, set())) <= 1 else "medium"))
                    last_full = {**tgt, "locator": loc}
                    antecedent_pos = pos
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
            else:  # bare: ibid., or an op./art./loc. cité with no author right before it
                item = {"page": page, "note": note, "kind": "bare", "phrase": payload}
                if not payload.lower().startswith("ibid"):
                    # « Lewent traduit par "…" (art.cité, p.608) »: an author NAMED earlier in
                    # this same note — in any case — is a nearer antecedent than whatever
                    # was cited before the note began (ibid. never does this: it means the
                    # immediately preceding reference, full stop)
                    for tm in reversed(list(re.finditer(r"\b[A-ZÀ-Þ][A-Za-zÀ-ÿ'’\-]{3,}", body[:pos]))):
                        if tm.start() <= antecedent_pos:
                            break
                        k = keyify(tm.group(0))
                        if k in SIGLUM_BY_SURNAME:          # "von Wartburg … (loc. cit.)" = FEW
                            sg = SIGLUM_BY_SURNAME[k]; d = SIGLUM_DEF[sg]
                            last_full = {"author": None, "title": d.get("definition") or d.get("expansion") or sg,
                                         "siglum": sg, "page": page, "note": note, "locator": None}
                        elif k in by_author:
                            last_full = {**by_author[k], "locator": None}
                        else:
                            continue
                        antecedent_pos = tm.start()
                        break
                if last_full:
                    # the antecedent as it stood: its work AND the place it was cited at
                    item.update(target=dict(last_full), confidence="medium")
                    resolved.append(item)
                    if loc:                       # "Ibid., p.117": the place moves on
                        last_full = {**last_full, "locator": loc}
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
          f" -> {(t.get('author') or t.get('siglum') or '')[:22]:22} {t['title'][:30]} ({t['page']})")
