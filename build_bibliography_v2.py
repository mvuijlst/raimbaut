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

manifest = json.load(open("manifest_v2.json", encoding="utf-8"))
by_printed = {}
pages = []
for e in manifest:
    p = e["printed"]
    pages.append(e)
    if p.isdigit():
        by_printed[int(p)] = e

CAP = r"[A-ZÀ-ÖØ-Þ]"
SURNAME = rf"{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\.\- ]*{CAP}"
SIGLUM = re.compile(r"\[([^\]]+)\]\{\.underline\}|\[([A-Z][A-Za-z.]{0,6})\]\s*$")
ENTRY_AUTHOR = re.compile(rf"^-\s+(?P<sur>{SURNAME})\s*,\s*(?P<rest>.*)$")
TITLE = re.compile(r"\*(?P<t1>[^*]+)\*|'(?P<t2>[^']{4,})'")
CHANSON_HDR = re.compile(r"^\*?CHANSON\s+([IVXL]+)\*?\s*$")


def body_lines(e):
    return [l for l in open(e["file"], encoding="utf-8").read().splitlines()
            if not l.startswith("<!-- page:")]


def flush_entry(buf, page, category, sink):
    text = re.sub(r"\s+", " ", " ".join(buf)).strip()
    if not text:
        return
    m = ENTRY_AUTHOR.match(text)
    author = m.group("sur").strip() if m else ""
    tm = TITLE.search(text)
    title = (tm.group("t1") or tm.group("t2")).strip() if tm else ""
    sm = SIGLUM.search(text)
    siglum = (sm.group(1) or sm.group(2)) if sm else ""
    sink.append({"author": author, "title": title, "siglum": siglum,
                 "text": text.lstrip("- ").strip(), "page": page, "category": category})


general, raimbaut = [], []
par_chanson = []      # {chanson, manuscrits, editions[]}
cur = None            # per-chanson accumulator

# order pages: bibliography start .. first index
bib_pages = [e for e in pages if e["printed"].isdigit() and 470 <= int(e["printed"]) <= 554]

buf, buf_page, buf_cat = [], None, None


def entry_sink(printed):
    return raimbaut if 512 <= printed <= 515 else general


for e in bib_pages:
    printed = int(e["printed"])
    parchanson_mode = printed >= 516
    for ln in body_lines(e):
        s = ln.strip()
        if not s:
            continue
        if parchanson_mode:
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
        # general / raimbaut: accumulate "- " entries
        if s.startswith("- "):
            if buf:
                flush_entry(buf, buf_page, buf_cat, entry_sink(buf_page))
            buf, buf_page, buf_cat = [s], printed, ("raimbaut" if 512 <= printed <= 515 else "general")
        elif re.match(rf"^([IVX]+\.|[A-Z]\.|\d+\.)\s", s) or s.startswith("*") and s.endswith("*"):
            # a section/subsection heading: flush current entry, don't accumulate
            if buf:
                flush_entry(buf, buf_page, buf_cat, entry_sink(buf_page)); buf = []
        elif buf:
            buf.append(s)     # continuation of the current entry (e.g. title on next line)
if buf:
    flush_entry(buf, buf_page, buf_cat, entry_sink(buf_page))

for c in par_chanson:
    c.pop("_mode", None)

out = {"general": general, "raimbaut": raimbaut, "par_chanson": par_chanson}
json.dump(out, open("bibliography.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"general entries: {len(general)}   raimbaut entries: {len(raimbaut)}   par-chanson blocks: {len(par_chanson)}")
print("sample general:")
for x in general[:4]:
    print(f"  {x['author'][:22]:22} | {x['title'][:48]}")
print("sample raimbaut (w/ sigla):")
for x in raimbaut:
    if x["siglum"]:
        print(f"  [{x['siglum']}] {x['author'][:20]:20} {x['title'][:40]}")
print("par-chanson chansons:", [c["chanson"] for c in par_chanson][:12], "...")
