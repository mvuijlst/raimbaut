"""
Build manifest.json: the reading order of the 2026 edition.

Reading order is simply PDF page order: vol1 (v1p000..) then vol2 (v2p000..),
which the zero-padded pageid sorts into directly. Each entry carries the printed
page number (from page_numbers.csv; blank for unnumbered leaves) for anchors,
and a coarse `kind` from the leading section header.

Output: manifest.json -- ordered [{order, pageid, vol, idx, printed, file, kind}].
"""
import csv
import glob
import json
import os
import re

PRINTED = {r["pageid"]: r["printed_number"]
           for r in csv.DictReader(open("page_numbers.csv", encoding="utf-8"))}

# `\]?\s*(?:\{\.underline\})?` tolerates headers wrapped by the transcription as
# "[CHANSON I ]{.underline} : REMARQUES" as well as the bare "CHANSON I : REMARQUES".
HEAD = [
    ("chanson-remarques", re.compile(r"CHANSON\s+[IVXL]+\s*\]?\s*(?:\{\.underline\})?\s*:?\s*REMARQUES", re.I)),
    ("chanson-texte",     re.compile(r"CHANSON\s+[IVXL]+\s*\]?\s*(?:\{\.underline\})?\s*:?\s*TEXTE", re.I)),
    ("introduction",      re.compile(r"^I\s*N\s*T\s*R\s*O\s*D\s*U\s*C\s*T\s*I\s*O\s*N", re.I)),
    ("bibliographie",     re.compile(r"^B\s*I\s*B\s*L\s*I\s*O\s*G\s*R\s*A\s*P\s*H\s*I\s*E", re.I)),
    ("index",             re.compile(r"^I\s*N\s*D\s*E\s*X\b", re.I)),
    ("table-matieres",    re.compile(r"TABLE\s+DES\s+MATI", re.I)),
]


def kind_of(pageid, text, printed):
    body = "\n".join(l for l in text.splitlines() if not l.startswith("<!-- page:"))
    head = body.strip()[:80]
    for name, rx in HEAD:
        if rx.search(head):
            return name
    if not printed:
        return "front-matter" if pageid < "v1p010" or pageid.startswith("v2p000") else "plate-or-divider"
    return "body"


manifest = []
for order, f in enumerate(sorted(glob.glob("corpus/*.md"))):
    pageid = os.path.basename(f)[:-3]
    m = re.match(r"v(\d)p(\d+)", pageid)
    text = open(f, encoding="utf-8").read()
    printed = PRINTED.get(pageid, "")
    manifest.append({"order": order, "pageid": pageid,
                     "vol": int(m.group(1)), "idx": int(m.group(2)),
                     "printed": printed, "file": f.replace("\\", "/"),
                     "kind": kind_of(pageid, text, printed)})

json.dump(manifest, open("manifest.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)
from collections import Counter
c = Counter(m["kind"] for m in manifest)
print(f"Wrote {len(manifest)} pages -> manifest.json")
print("kinds:", dict(c))
