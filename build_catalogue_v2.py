"""
Build chansons.json: the catalogue of chansons I-XXXIX for the 2026 edition.

Walk the manifest in reading order; each page whose body opens with
"CHANSON <N>: REMARQUES" or "... TEXTE ET TRADUCTION" starts that section for
chanson N. A chanson's section runs until the next section header. The incipit
is the first verse line of the TEXTE section. Printed page numbers give the
human-facing ranges.

User correction: v2p057 belongs to Chanson XXXIII (its texte header sits on an
earlier page / was not detected there) -- handled via OVERRIDE below.

Output: chansons.json.
"""
import json
import re

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8,
         "IX": 9, "X": 10, "XI": 11, "XII": 12, "XIII": 13, "XIV": 14, "XV": 15,
         "XVI": 16, "XVII": 17, "XVIII": 18, "XIX": 19, "XX": 20, "XXI": 21,
         "XXII": 22, "XXIII": 23, "XXIV": 24, "XXV": 25, "XXVI": 26, "XXVII": 27,
         "XXVIII": 28, "XXIX": 29, "XXX": 30, "XXXI": 31, "XXXII": 32, "XXXIII": 33,
         "XXXIV": 34, "XXXV": 35, "XXXVI": 36, "XXXVII": 37, "XXXVIII": 38, "XXXIX": 39}

HDR = re.compile(r"CHANSON\s+([IVXL]+)\s*:?\s*(REMARQUES|TEXTE)", re.I)
manifest = json.load(open("manifest_v2.json", encoding="utf-8"))


def body(e):
    return "\n".join(l for l in open(e["file"], encoding="utf-8").read().splitlines()
                     if not l.startswith("<!-- page:")).strip()


def first_verse_line(e):
    inv = False
    for l in open(e["file"], encoding="utf-8"):
        s = l.strip()
        if s.startswith(":::") and ".verse" in s:
            inv = True; continue
        if inv and s and s != ":::":
            s = re.sub(r"^\d+\.\s*", "", s)
            # chanson XXXIV is lacunose in the thesis (illegible ms.): its first
            # verse prints as runs of dots. Collapse them to a single ellipsis so
            # the incipit reads "Parliers…ana" rather than a wall of dots.
            s = re.sub(r"\.{3,}", "…", s)
            return s
    return ""


# collect section headers in reading order
sections = []   # (order, roman, num, kind, pageid, printed, incipit)
for e in manifest:
    m = HDR.search(body(e)[:80])
    if not m:
        continue
    roman = m.group(1).upper()
    if roman not in ROMAN:
        continue
    kind = "remarques" if m.group(2).upper().startswith("REM") else "texte"
    inc = first_verse_line(e) if kind == "texte" else ""
    sections.append({"order": e["order"], "roman": roman, "num": ROMAN[roman],
                     "kind": kind, "pageid": e["pageid"], "printed": e["printed"],
                     "incipit": inc})

# A chanson section ends just before the next chanson header. The LAST chanson
# (XXXIX) would otherwise run all the way to the back matter, swallowing the
# concluding chapter "VERS UNE POÉTIQUE DE RAIMBAUT D'ORANGE" (v2p098-v2p178,
# ~80 pp) which is NOT part of any chanson's texte. So the terminal boundary is
# the EARLIEST of: the back matter, or that concluding-chapter heading.
POST_CHANSON_HDR = re.compile(r"^VERS\s+UNE\s+PO[EÉ]TIQUE", re.I)
boundary_orders = [e["order"] for e in manifest
                   if e["kind"] in ("bibliographie", "index", "table-matieres")
                   or POST_CHANSON_HDR.match(body(e)[:60])]
backmatter_start = min(boundary_orders) if boundary_orders else len(manifest)
orders = [s["order"] for s in sections] + [backmatter_start]
by_order = {e["order"]: e for e in manifest}

chansons = {}
for i, s in enumerate(sections):
    start, end = s["order"], orders[i + 1] - 1
    pages = [by_order[o]["pageid"] for o in range(start, end + 1)]
    printed = [by_order[o]["printed"] for o in range(start, end + 1) if by_order[o]["printed"]]
    ch = chansons.setdefault(s["num"], {"num": s["num"], "roman": s["roman"], "incipit": ""})
    ch[s["kind"]] = {"pages": pages,
                     "printed_range": [printed[0], printed[-1]] if printed else []}
    if s["incipit"]:
        ch["incipit"] = s["incipit"]

out = [chansons[n] for n in sorted(chansons)]
json.dump(out, open("chansons.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

found = sorted(chansons)
missing = [n for n in range(1, 40) if n not in chansons]
print(f"catalogue: {len(out)} chansons  (I..{out[-1]['roman']})")
print("numbers present:", found)
print("MISSING numbers:", missing or "none")
for ch in out:
    r = ch.get("texte", {}).get("printed_range") or ch.get("remarques", {}).get("printed_range") or []
    print(f"  {ch['roman']:>6} ({ch['num']:2})  pp.{'-'.join(r):>9}  {ch['incipit'][:46]}")
