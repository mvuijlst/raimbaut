"""
Build the unified authoritative transcription corpus.

The A/B diff (review-diff.md) showed gpt-4o is near-publication on prose but
badly corrupts the Occitan/verse pages, where Claude is clean. So the best
single corpus is: gpt-4o everywhere, with the 43 Occitan/verse pages
(occitan_pages.txt) overlaid from the Claude pass.

Sources are left untouched as provenance:
  transcripts/         pure gpt-4o
  transcripts-claude/  pure Claude (the 43)
Output:
  corpus/              one authoritative .md per page (what assembly consumes)
  corpus/_sources.csv  page -> which pass it came from
"""

import csv
import shutil
from pathlib import Path

GPT = Path("transcripts")
CLAUDE = Path("transcripts-claude")
CORPUS = Path("corpus")
OVERLAY = set(Path("occitan_pages.txt").read_text().split())

CORPUS.mkdir(exist_ok=True)
rows = []
for src in sorted(GPT.glob("page-*.md")):
    stem = src.stem
    if stem in OVERLAY:
        shutil.copyfile(CLAUDE / f"{stem}.md", CORPUS / f"{stem}.md")
        rows.append((stem, "claude"))
    else:
        shutil.copyfile(src, CORPUS / f"{stem}.md")
        rows.append((stem, "gpt-4o"))

with (CORPUS / "_sources.csv").open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["page", "source"])
    w.writerows(rows)

n_claude = sum(1 for _, s in rows if s == "claude")
print(f"corpus/: {len(rows)} pages ({n_claude} from Claude, {len(rows)-n_claude} from gpt-4o)")
missing = OVERLAY - {s for s, _ in rows}
if missing:
    print("WARNING: overlay pages not found in gpt-4o set:", sorted(missing))
