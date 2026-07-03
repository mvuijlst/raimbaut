"""
A/B diff of the two transcription passes on the Occitan/verse subset:
gpt-4o (transcripts/) vs Claude (transcripts-claude/).

Both passes use different markup habits (verse divs, lang spans, footnote
placement), so a raw line diff is pure noise. Instead we strip all markup down
to a plain word stream and do a word-level alignment -- this isolates the actual
TEXTUAL disagreements (mostly Occitan spellings), which is the point of the A/B.

Output:
  review-diff.md   per-page hunks, pages ordered most-divergent first
  console summary  similarity per page + totals
Each hunk shows a little context and  «gpt-4o words» ¦ «claude words».
"""

import difflib
import re
from pathlib import Path

A_DIR = Path("transcripts")          # gpt-4o
B_DIR = Path("transcripts-claude")   # Claude
OUT = Path("review-diff.md")
STEMS = Path("occitan_pages.txt").read_text().split()
CTX = 4  # words of context on each side of a hunk


def normalize(md):
    """Strip markup + cosmetic differences to a plain word stream for comparison.

    Cosmetic noise we deliberately fold away (both passes are 'right', just
    differ in convention): oe/oe ligatures, and French spacing before ; : ? ! ».
    What remains is genuine textual disagreement -- mostly Occitan spellings.
    """
    md = re.sub(r"<!--.*?-->", " ", md, flags=re.S)      # page anchors
    md = re.sub(r"\[\[hand:[^\]]*\]\]", " ", md)          # editorial hand notes
    md = re.sub(r"^:::.*$", " ", md, flags=re.M)          # fenced div markers
    md = re.sub(r"\[\^[^\]]*\]:?", " ", md)               # footnote refs/defs
    md = re.sub(r"\[([^\]]*)\]\{[^}]*\}", r"\1", md)      # [text]{.span} -> text
    md = md.replace("*", " ").replace("_", " ").replace("#", " ")
    md = md.replace("­", "")                          # soft hyphen
    md = (md.replace("œ", "oe").replace("Œ", "Oe")
            .replace("æ", "ae").replace("Æ", "Ae"))
    md = re.sub(r"\s+([;:?!»])", r"\1", md)               # French spacing
    md = re.sub(r"([«])\s+", r"\1", md)
    return md.split()


def hunks(a, b):
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    out = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        pre = " ".join(a[max(0, i1 - CTX):i1])
        post = " ".join(a[i2:i2 + CTX])
        ga = " ".join(a[i1:i2]) or "∅"
        gb = " ".join(b[j1:j2]) or "∅"
        out.append((pre, ga, gb, post))
    return out, sm.ratio()


def main():
    rows = []
    for stem in STEMS:
        fa, fb = A_DIR / f"{stem}.md", B_DIR / f"{stem}.md"
        if not (fa.exists() and fb.exists()):
            print(f"  skip {stem}: missing a transcript")
            continue
        a, b = normalize(fa.read_text("utf-8")), normalize(fb.read_text("utf-8"))
        hs, ratio = hunks(a, b)
        rows.append((stem, ratio, hs, len(a)))

    rows.sort(key=lambda r: r[1])  # most divergent first
    total_h = sum(len(r[2]) for r in rows)

    with OUT.open("w", encoding="utf-8") as f:
        f.write("# A/B transcription diff — gpt-4o vs Claude\n\n")
        f.write(f"{len(rows)} pages, {total_h} differing hunks. "
                "Ordered most-divergent first. Each hunk: `«gpt-4o» ¦ «claude»`.\n\n")
        for stem, ratio, hs, n in rows:
            f.write(f"## {stem} — {ratio:.1%} similar, {len(hs)} hunks\n\n")
            for pre, ga, gb, post in hs:
                f.write(f"- …{pre} **«{ga}» ¦ «{gb}»** {post}…\n")
            f.write("\n")

    print(f"{'page':16} {'similar':>8} {'hunks':>6}")
    for stem, ratio, hs, n in rows:
        print(f"{stem:16} {ratio:>7.1%} {len(hs):>6}")
    print(f"\nTotal: {total_h} hunks across {len(rows)} pages -> {OUT}")


if __name__ == "__main__":
    main()
