"""Build the authoritative corpus for the 2026 PDF-based edition.

Base = gpt-4o transcripts (transcripts-v2/, all 586 vol1+vol2 pages).
Overlay = Claude (in-session) transcripts (transcripts-v2-claude/) for the
verse/Occitan pages, where gpt-4o is unreliable on Old Provençal.

corpus-v2/ is what assembly consumes. _sources.csv records per-page provenance.
Re-runnable: it simply re-copies base + overlays whatever Claude pages exist.
"""
import csv
import shutil
from pathlib import Path

BASE = Path("transcripts-v2")
OVERLAY = Path("transcripts-v2-claude")
OUT = Path("corpus-v2")

OUT.mkdir(exist_ok=True)
base = {p.stem: p for p in BASE.glob("v*.md")}
over = {p.stem: p for p in OVERLAY.glob("v*.md")}

rows = []
for pageid, path in sorted(base.items()):
    src = over.get(pageid, path)
    prov = "claude" if pageid in over else "gpt-4o"
    shutil.copyfile(src, OUT / f"{pageid}.md")
    rows.append((pageid, prov))

with open("corpus-v2-sources.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["pageid", "provenance"])
    w.writerows(rows)

n_claude = sum(1 for _, p in rows if p == "claude")
print(f"corpus-v2/: {len(rows)} pages  ({n_claude} claude-overlaid, {len(rows)-n_claude} gpt-4o)")
missing = [pid for pid in over if pid not in base]
if missing:
    print(f"WARNING: {len(missing)} overlay pages have no gpt-4o base: {missing[:10]}")
