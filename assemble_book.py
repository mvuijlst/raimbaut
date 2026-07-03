"""
Stitch the corpus into one document in reading order (book.md).

Per-page footnotes all restart at [^1], so naive concatenation collides. We
namespace every footnote label with its page key ([^1] on page-016 -> [^016-1]).
Markdown renderers still number footnotes sequentially by order of appearance,
so the reader sees a continuous 1,2,3… while labels stay unique and traceable.

Two wrinkles this handles:

1. A [^N] marker in running text can be immediately followed by a literal colon
   (e.g. "le classement suivant[^1]:" introducing a table). A definition is ONLY
   a [^N]: at the START of a line — so we classify by position, not by a naive
   look-ahead. (The old heuristic mis-flagged these as page-spanning.)

2. A footnote whose text overflows the page: the marker sits at the bottom of
   page N's running text (a "dangling" ref, defined nowhere on N) while its text
   lands atop page N+1's footnote block, renumbered to [^1] (an "orphan" def,
   referenced nowhere on N+1). We pair dangling refs on N with orphan defs on
   N+1 in order and relabel the overflowed definition to its reference's page
   key, so ref and def reunite under one label. Every join is logged.

Output:
  book.md            the stitched edition (footnotes reunited)
  footnote-issues.md joins performed + any residue still to reconcile by hand
"""

import json
import re
from pathlib import Path

MANIFEST = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
OUT = Path("book.md")
ISSUES = Path("footnote-issues.md")

DEF_LINE = re.compile(r"^\[\^([^\]]+)\]:", re.M)   # definition: [^x]: at line start
TOKEN = re.compile(r"\[\^([^\]]+)\]")              # any footnote token [^x]


def key(stem):
    return stem[len("page-"):]


# ---- pass 1: parse each page into ordered refs / defs ----------------------
pages = []
for m in MANIFEST:
    text = Path(m["file"]).read_text(encoding="utf-8")
    def_starts = {mo.start() for mo in DEF_LINE.finditer(text)}
    refs, defs = [], []
    for mo in TOKEN.finditer(text):
        (defs if mo.start() in def_starts else refs).append(mo.group(1))
    refset, defset = set(refs), set(defs)
    pages.append({**m, "text": text, "k": key(m["stem"]),
                  "refs": refs, "defs": defs,
                  "dangling": [r for r in refs if r not in defset],   # ref here, def elsewhere
                  "orphan":   [d for d in defs if d not in refset]})  # def here, ref elsewhere

# ---- pass 2: default namespacing + cross-page overflow joins ---------------
remap = []
for p in pages:
    remap.append({X: f"{p['k']}-{X}" for X in set(p["refs"]) | set(p["defs"])})

joins, residue_dangling, residue_orphan = [], [], []
for i in range(len(pages) - 1):
    dang = sorted(pages[i]["dangling"])
    orph = sorted(pages[i + 1]["orphan"])
    n = min(len(dang), len(orph))
    for r, d in zip(dang[:n], orph[:n]):
        # the overflowed definition on the next page adopts this page's ref label
        remap[i + 1][d] = f"{pages[i]['k']}-{r}"
        joins.append((pages[i]["label"], pages[i]["stem"], r,
                      pages[i + 1]["label"], pages[i + 1]["stem"], d))

# ---- apply the remap and write book.md -------------------------------------
parts = []
for i, p in enumerate(pages):
    rm = remap[i]
    text = TOKEN.sub(lambda mo: f"[^{rm[mo.group(1)]}]", p["text"])
    parts.append(text.strip())
OUT.write_text("\n\n".join(parts) + "\n", encoding="utf-8")

# ---- verify globally: any label left with a ref but no def (or vice versa) --
book = OUT.read_text(encoding="utf-8")
b_def_starts = {mo.start() for mo in DEF_LINE.finditer(book)}
b_refs, b_defs = set(), set()
for mo in TOKEN.finditer(book):
    (b_defs if mo.start() in b_def_starts else b_refs).add(mo.group(1))
still_dangling = sorted(b_refs - b_defs)   # referenced, never defined
still_orphan = sorted(b_defs - b_refs)     # defined, never referenced

# ---- report ----------------------------------------------------------------
# For hand recovery it helps to see WHICH footnote each residue is, so we pull
# the definition text (orphans) / the marker's sentence (dangling) from source.
def def_text(stem, label):
    txt = next(p["text"] for p in pages if p["stem"] == stem)
    m = re.search(r"^\[\^" + re.escape(label) + r"\]:[ \t]*(.+)", txt, re.M)
    return re.sub(r"\s+", " ", m.group(1)).strip()[:110] if m else ""

def ref_context(stem, label):
    txt = next(p["text"] for p in pages if p["stem"] == stem)
    m = re.search(r"(.{0,70})\[\^" + re.escape(label) + r"\]", txt)
    return re.sub(r"\s+", " ", m.group(1)).strip()[-70:] if m else ""

orphan_by_page = [(p["label"], p["stem"], d) for p in pages for d in p["orphan"]
                  if f"{p['k']}-{d}" in still_orphan]
dangling_by_page = [(p["label"], p["stem"], r) for p in pages for r in p["dangling"]
                    if f"{p['k']}-{r}" in still_dangling]

with ISSUES.open("w", encoding="utf-8") as f:
    f.write("# Footnote reconciliation report\n\n")
    f.write(f"**{len(joins)} page-spanning footnote(s) auto-joined** — a marker "
            "at the foot of one page whose text overflowed (renumbered) onto the "
            "next; ref and def reunited under one label.\n\n")
    f.write("| ref page | ref | ← def page | def was | def text |\n|---|---|---|---|---|\n")
    for rl, rs, r, dl, ds, d in joins:
        f.write(f"| {rl} | [^{r}] | {dl} | [^{d}] | {def_text(ds, d)} |\n")

    f.write("\n## Dropped markers — definition present, superscript missing from body\n\n")
    f.write("The transcription kept the footnote text at the page foot but dropped "
            "the reference numeral in the running text. The marker must be placed "
            "against the original scan. Each row shows the orphaned definition.\n\n")
    f.write("| page | note | definition text (to locate in scan) |\n|---|---|---|\n")
    for lbl, stem, d in orphan_by_page:
        f.write(f"| {lbl} | [^{d}] | {def_text(stem, d)} |\n")

    f.write("\n## Dropped / overflowed definitions — marker present, text missing\n\n")
    f.write("The reference survives in the body but no definition text was "
            "transcribed on the page (or an adjacent page). Recover the note text "
            "from the scan.\n\n")
    f.write("| page | ref | marker context (…precedes the marker) |\n|---|---|---|\n")
    for lbl, stem, r in dangling_by_page:
        f.write(f"| {lbl} | [^{r}] | …{ref_context(stem, r)} |\n")

    f.write(f"\n---\n*{len(orphan_by_page)} dropped markers, "
            f"{len(dangling_by_page)} dropped definitions to recover from scans.*\n")

total_def = len(b_defs)
print(f"book.md: {len(MANIFEST)} pages, {OUT.stat().st_size // 1024} KB, {total_def} footnote labels")
print(f"joins performed: {len(joins)}")
print(f"residue: {len(still_dangling)} refs w/o def, {len(still_orphan)} defs w/o ref")
if still_dangling:
    print("  dangling:", ", ".join(still_dangling))
if still_orphan:
    print("  orphan:  ", ", ".join(still_orphan))
