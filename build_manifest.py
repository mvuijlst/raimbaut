"""
Build manifest.json: the reading order of the edition.

The logical page LABELS (i, ii, 234a, the two unnumbered title pages, the
pagination jumps) don't sort into reading order on their own. But the original
scan sequence does -- it is physical page order. rename_map.csv records
old (pages/page_NNN.png, scan order) -> new (corpus stem), so we order by the
scan number and carry the logical label along. Rejected duplicate scans are
skipped.

Output: manifest.json -- ordered [{order, file, stem, label, kind}].
"""

import csv
import json
import re
from pathlib import Path

RENAME = Path("rename_map.csv")
CORPUS = Path("corpus")
OUT = Path("manifest.json")


def classify(stem):
    s = stem[len("page-"):]
    if s in ("i", "ii", "iii", "iv", "v"):
        return s, "front-matter"
    if s.startswith("title-"):
        return s[len("title-"):], "section-title"
    m = re.fullmatch(r"(\d+)([a-z])", s)
    if m:
        return f"{int(m.group(1))}{m.group(2)}", "body-insert"
    if s.isdigit():
        return str(int(s)), "body"
    return s, "other"


def scan_no(old_path):
    m = re.search(r"page_(\d+)\.png", old_path)
    return int(m.group(1)) if m else 10**9


rows = []
for r in csv.DictReader(RENAME.open(encoding="utf-8")):
    if "/rejects/" in r["new"]:
        continue
    stem = Path(r["new"]).stem
    rows.append((scan_no(r["old"]), stem))

rows.sort()
manifest = []
for i, (_, stem) in enumerate(rows):
    md = CORPUS / f"{stem}.md"
    if not md.exists():
        print(f"WARNING: no corpus file for {stem}")
        continue
    label, kind = classify(stem)
    manifest.append({"order": i, "file": f"corpus/{stem}.md",
                     "stem": stem, "label": label, "kind": kind})

OUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Wrote {len(manifest)} pages -> {OUT}\n")
# show the interesting boundaries (front matter, title pages, insert)
for m in manifest:
    if m["kind"] != "body":
        nbrs = f"[{m['order']}] {m['stem']}  ({m['kind']}: {m['label']})"
        print(nbrs)
