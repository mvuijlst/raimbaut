"""
Stitch corpus-v2 into one document in reading order (book.md), for the 2026 edition.

Handles three things:
1. Per-page footnotes all restart at [^1]; namespace each label with its pageid
   ([^1] on v1p092 -> [^v1p092-1]) so renderers still number 1,2,3… but labels
   stay unique/traceable.
2. Page-overflow footnotes: a dangling ref at the foot of page N pairs with an
   orphan def (renumbered [^1]) atop page N+1; reunite them under one label.
3. CROSS-PAGE WORD SPLITS: a page's body ends mid-word on a soft hyphen (letter-),
   the word finishing atop the next page. We pull the continuation token onto the
   previous page and drop the hyphen. (Within-page soft hyphens were already healed
   by normalize_typography; these 45-odd are the boundary cases it couldn't reach.)

Each page keeps its <!-- page: … --> anchor (not rendered; provenance).

Output: book.md, footnote-issues-v2.md, corrections-crosspage-hyphen-v2.csv
"""
import csv
import json
import re

MANIFEST = json.load(open("manifest_v2.json", encoding="utf-8"))
DEF_LINE = re.compile(r"^\[\^([^\]]+)\]:", re.M)
TOKEN = re.compile(r"\[\^([^\]]+)\]")
ANCHOR = re.compile(r"^<!-- page:.*-->$", re.M)
SOFT_END = re.compile(r"[0-9A-Za-zà-ÿÀ-ß]-$")
HEADERISH = re.compile(r"^(CHANSON\b|:::|#|[IVX]+\.|[A-Z]\.\s|⁂|B\s?I\s?B|I\s?N\s?D)", re.I)


def split_page(text):
    """(anchor_line, body_lines[], footnote_lines[])."""
    lines = text.split("\n")
    anchor = ""
    if lines and lines[0].startswith("<!-- page:"):
        anchor = lines[0]; lines = lines[1:]
    fn_start = next((i for i, l in enumerate(lines) if DEF_LINE.match(l)), len(lines))
    body = lines[:fn_start]
    foot = lines[fn_start:]
    return anchor, body, foot


pages = []
for m in MANIFEST:
    anchor, body, foot = split_page(open(m["file"], encoding="utf-8").read())
    pages.append({**m, "anchor": anchor, "body": body, "foot": foot})

# ---- footnote namespacing + overflow joins (BEFORE word-split healing) -----
# Namespacing must run first: the cross-page word-split heal below can drag a
# footnote marker across a page boundary (e.g. "sous-|entendu[^1]"). If that
# marker were still bare when moved, it would be namespaced under the WRONG
# page and orphan its definition. So we resolve every label to pageid-N here,
# then heal word-splits on already-namespaced text where tokens are inert.
def refs_defs(body, foot):
    text = "\n".join(body + foot)
    defstart = {mo.start() for mo in DEF_LINE.finditer(text)}
    refs, defs = [], []
    for mo in TOKEN.finditer(text):
        (defs if mo.start() in defstart else refs).append(mo.group(1))
    return refs, defs

for p in pages:
    r, d = refs_defs(p["body"], p["foot"])
    p["refs"], p["defs"] = r, d
    ds = set(d); rs = set(r)
    p["dangling"] = [x for x in r if x not in ds]
    p["orphan"] = [x for x in d if x not in rs]

remap = [{X: f"{p['pageid']}-{X}" for X in set(p["refs"]) | set(p["defs"])} for p in pages]
joins = []
for i in range(len(pages) - 1):
    dang, orph = sorted(pages[i]["dangling"]), sorted(pages[i + 1]["orphan"])
    for r, d in zip(dang, orph[:len(dang)]):
        remap[i + 1][d] = f"{pages[i]['pageid']}-{r}"
        joins.append((pages[i]["pageid"], r, pages[i + 1]["pageid"], d))

# apply the remap in place so each page's tokens now carry their final label
for i, p in enumerate(pages):
    rm = remap[i]
    sub = lambda mo: f"[^{rm.get(mo.group(1), mo.group(1))}]"
    p["body"] = [TOKEN.sub(sub, l) for l in p["body"]]
    p["foot"] = [TOKEN.sub(sub, l) for l in p["foot"]]

# ---- cross-page word-split joins (on already-namespaced text) --------------
hyjoins = []
for i in range(len(pages) - 1):
    body = pages[i]["body"]
    # last non-empty body line
    li = next((k for k in range(len(body) - 1, -1, -1) if body[k].strip()), None)
    if li is None or not SOFT_END.search(body[li].rstrip()):
        continue
    nxt = pages[i + 1]
    nb = nxt["body"]
    fi = next((k for k in range(len(nb)) if nb[k].strip()), None)
    if fi is None or HEADERISH.match(nb[fi].strip()):
        continue
    first = nb[fi].lstrip()
    tok = first.split(" ", 1)
    cont, remainder = tok[0], (tok[1] if len(tok) > 1 else "")
    stub = body[li].rstrip()[:-1]           # drop hyphen
    pages[i]["body"][li] = stub + cont       # heal onto previous page
    nxt["body"][fi] = remainder
    hyjoins.append((pages[i]["pageid"], stub[-18:] + "|" + cont, nxt["pageid"]))

parts = []
for p in pages:
    text = "\n".join([p["anchor"]] + p["body"] + p["foot"]) if p["anchor"] else "\n".join(p["body"] + p["foot"])
    parts.append(text.strip())
open("book.md", "w", encoding="utf-8").write("\n\n".join(parts) + "\n")

# ---- verify globally -------------------------------------------------------
book = open("book.md", encoding="utf-8").read()
defstart = {mo.start() for mo in DEF_LINE.finditer(book)}
brefs, bdefs = set(), set()
for mo in TOKEN.finditer(book):
    (bdefs if mo.start() in defstart else brefs).add(mo.group(1))
dangling, orphan = sorted(brefs - bdefs), sorted(bdefs - brefs)

with open("corrections-crosspage-hyphen-v2.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh); w.writerow(["prev_page", "stub|cont", "next_page"]); w.writerows(hyjoins)
with open("footnote-issues-v2.md", "w", encoding="utf-8") as f:
    f.write(f"# Footnote reconciliation (v2)\n\n{len(joins)} page-overflow joins.\n\n")
    f.write(f"residual: {len(dangling)} refs without def, {len(orphan)} defs without ref\n\n")
    if dangling: f.write("dangling: " + ", ".join(dangling) + "\n\n")
    if orphan: f.write("orphan: " + ", ".join(orphan) + "\n")

kb = len(book.encode("utf-8")) // 1024
print(f"book.md: {len(pages)} pages, {kb} KB, {len(bdefs)} footnote labels")
print(f"cross-page hyphen joins: {len(hyjoins)}   footnote overflow joins: {len(joins)}")
print(f"residual footnotes: {len(dangling)} dangling, {len(orphan)} orphan")
if dangling[:12]: print("  dangling:", ", ".join(dangling[:12]))
if orphan[:12]: print("  orphan:  ", ", ".join(orphan[:12]))
