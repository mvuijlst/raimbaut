"""
Rename the raw scan files (pages/page_NNN.png) to logical page names driven by
page_numbers.csv, following front-matter / title-page conventions.

Naming scheme
-------------
  front matter (roman)      -> page-i.png, page-ii.png
  section title pages       -> page-title-introduction.png, page-title-chansonnier.png
  numbered body             -> page-001.png ... page-358.png (zero-padded to 3)
  mis-numbered insert       -> page-234a.png

Corrections applied on top of the CSV (verified against the scans):
  * page_379.png: CSV says 352 but its text continues directly from p.357
    (page_378) -> it is page 358.
  * page_372.png & page_373.png are BOTH scans of page 352. page_373 is clean;
    page_372 has its left margin cropped (defective). page_373 becomes
    page-352.png; the defective duplicate is moved to pages/rejects/.

Old names use 'page_' (underscore); new names use 'page-' (hyphen), so the old
and new namespaces never collide and renaming can be done in a single pass.

Writes rename_map.csv (old -> new) as a reversible audit trail.
Run with --apply to actually move files; without it, dry-run only.
"""

import csv
import sys
from pathlib import Path

PAGES = Path("pages")
CSV = Path("page_numbers.csv")
REJECTS = PAGES / "rejects"
MAP_OUT = Path("rename_map.csv")

# filename -> explicit override of the target *name* (relative to pages/)
TITLE_PAGES = {
    "page_003.png": "page-title-introduction.png",
    "page_062.png": "page-title-chansonnier.png",
}
# defective duplicate scans -> moved into pages/rejects/ under this name
REJECT_AS = {
    "page_372.png": "page-352-duplicate-cropped.png",
}
# corrections to the CSV page_number value (verified visually)
NUMBER_FIX = {
    "page_379.png": "358",
}


def target_name(filename, page_number):
    """Return the new basename for a normal (kept) page, or None if unhandled."""
    if filename in TITLE_PAGES:
        return TITLE_PAGES[filename]
    pn = NUMBER_FIX.get(filename, page_number).strip()
    if pn in ("i", "ii"):
        return f"page-{pn}.png"
    if pn.isdigit():
        return f"page-{int(pn):03d}.png"
    # e.g. "234a": numeric stem + alpha suffix
    if pn[:-1].isdigit() and pn[-1].isalpha():
        return f"page-{int(pn[:-1]):03d}{pn[-1]}.png"
    raise ValueError(f"Don't know how to name {filename!r} with page_number {pn!r}")


def main(apply):
    rows = list(csv.DictReader(CSV.open(encoding="utf-8")))
    plan = []          # (src_path, dst_path, note)
    targets = {}       # dst basename -> src filename, to catch collisions

    for r in rows:
        fn = r["filename"]
        src = PAGES / fn
        if not src.exists():
            sys.exit(f"MISSING source file: {src}")

        if fn in REJECT_AS:
            dst = REJECTS / REJECT_AS[fn]
            plan.append((src, dst, "DEFECTIVE DUPLICATE -> rejects/"))
            continue

        name = target_name(fn, r["page_number"])
        if name in targets:
            sys.exit(f"COLLISION: {fn} and {targets[name]} both -> {name}")
        targets[name] = fn
        note = ""
        if fn in TITLE_PAGES:
            note = "title page"
        elif fn in NUMBER_FIX:
            note = f"CSV said {r['page_number']!r}, corrected to {NUMBER_FIX[fn]}"
        plan.append((src, PAGES / name, note))

    # report the interesting (non-plain) cases
    print(f"Total files: {len(plan)}   (no target collisions)\n")
    print("Special cases:")
    for src, dst, note in plan:
        if note:
            print(f"  {src.name:16s} -> {dst.relative_to(PAGES.parent)}   [{note}]")

    if not apply:
        print("\nDry run only. Re-run with --apply to perform the renames.")
        return

    REJECTS.mkdir(exist_ok=True)
    with MAP_OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["old", "new"])
        for src, dst, _ in plan:
            src.rename(dst)
            w.writerow([f"pages/{src.name}", str(dst).replace("\\", "/")])
    print(f"\nRenamed {len(plan)} files. Audit trail -> {MAP_OUT}")


if __name__ == "__main__":
    main("--apply" in sys.argv)
