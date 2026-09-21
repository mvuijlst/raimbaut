"""
Subset the Junicode variable fonts for the web.

    venv\\Scripts\\python site\\tools\\subset_fonts.py        (needs: pip install fonttools brotli)

Reads the source fonts from site/fonts-src/ (a Latin web build of Junicode VF, ~300 KB
each, three variable axes) and writes the web fonts to site/src/fonts/ (~175 KB each).

What changes, and what is kept:
  * the width and "ENLA" (enlarge) axes are pinned to their defaults — no stylesheet rule
    touches them, and their variation data is 40 % of the file. The weight axis stays
    (the CSS uses 390–700). This is where the saving comes from;
  * characters: a whitelist of generous Unicode RANGES, not the exact characters in use,
    so an ordinary corpus edit can never silently fall back to a system font. With the
    current source fonts the whitelist drops nothing; it matters if fonts-src/ is ever
    replaced by the full Junicode release (5,000+ medievalist glyphs);
  * the OpenType features the CSS asks for (small caps, old-style/lining/tabular figures,
    ligatures) plus the ones shaping needs (kerning, mark positioning, composition).
"""
import glob
import html
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SITE = Path(__file__).resolve().parent.parent
SRC, OUT = SITE / "fonts-src", SITE / "src" / "fonts"
# source name -> web name. The web files are cached for a year as "immutable"
# (server/nginx-raimbaut.conf): if this script's output ever changes, RENAME it here,
# in css/raimbaut.css and in the preload links of _includes/base.njk.
FONTS = {"JunicodeVF-Roman.woff2": "JunicodeWeb-Roman.woff2",
         "JunicodeVF-Italic.woff2": "JunicodeWeb-Italic.woff2"}

RANGES = [
    (0x0020, 0x007E), (0x00A0, 0x024F),   # Latin: basic, Latin-1, Extended-A/B
    (0x0250, 0x02FF),                     # IPA, spacing modifiers
    (0x0300, 0x036F),                     # combining diacritics
    (0x0370, 0x03FF), (0x1F00, 0x1FFF),   # Greek, polytonic Greek
    (0x1D00, 0x1DBF),                     # phonetic extensions, modifier letters
    (0x1E00, 0x1EFF),                     # Latin Extended Additional (dot below, tilde…)
    (0x2000, 0x206F), (0x2070, 0x209F),   # punctuation & spaces, super/subscripts
    (0x20A0, 0x20BF), (0x2100, 0x218F),   # currency, letterlike, number forms
    (0x2190, 0x21FF), (0x2200, 0x22FF),   # arrows, mathematical operators
    (0x2300, 0x23FF), (0x25A0, 0x25FF),   # technical, geometric shapes
    (0x2700, 0x27BF), (0x27F0, 0x27FF),   # dingbats (✎), long arrows
    (0x2E00, 0x2E7F),                     # supplemental (medieval) punctuation
    (0xA720, 0xA7FF),                     # Latin Extended-D (medievalist letters)
    (0xFB00, 0xFB06),                     # Latin ligatures
]
FEATURES = ["kern", "mark", "mkmk", "ccmp", "locl", "liga", "calt",
            "smcp", "c2sc", "onum", "pnum", "lnum", "tnum", "sups", "subs", "frac", "case"]


def build():
    unicodes = [u for a, b in RANGES for u in range(a, b + 1)]
    for name, web in FONTS.items():
        font = TTFont(SRC / name)
        opts = subset.Options()
        opts.layout_features = FEATURES
        opts.flavor = "woff2"
        opts.name_IDs = ["*"]            # keep the copyright / licence name records (OFL)
        opts.notdef_outline = True
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=unicodes)
        sub.subset(font)
        # pin the unused axes AFTER subsetting (the subsetter trips over the variation
        # table of an already-instanced font)
        pin = {a.axisTag: a.defaultValue for a in font["fvar"].axes if a.axisTag != "wght"}
        font = instantiateVariableFont(font, pin)
        font.flavor = "woff2"
        font.save(OUT / web)
        before, after = (SRC / name).stat().st_size, (OUT / web).stat().st_size
        print(f"{name} -> {web}: {before:,} -> {after:,} bytes ({len(font.getBestCmap()):,} characters)")


def check():
    """Characters of the built site that the SOURCE font has but the web font lost.
    (Arrows, Greek, a few IPA letters were never in Junicode: the browser takes those
    from a fallback font either way, so they are counted, not listed.)"""
    used = set()
    for f in glob.glob(str(SITE / "_site" / "**" / "*.html"), recursive=True):
        t = open(f, encoding="utf-8").read()
        t = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
        used |= set(html.unescape(re.sub(r"<[^>]+>", " ", t)))
    used = {c for c in used if ord(c) >= 0x20}
    if not used:
        sys.exit("no built site found: run `npm run build` in site/ first")
    lost_any = False
    for name, webname in FONTS.items():
        web, src = TTFont(OUT / webname).getBestCmap(), TTFont(SRC / name).getBestCmap()
        lost = sorted(c for c in used if ord(c) in src and ord(c) not in web)
        never = sum(1 for c in used if ord(c) not in src)
        print(f"{webname}: {len(used)} characters in the built site — {len(lost)} lost by "
              f"subsetting, {never} not in Junicode at all (fallback font)")
        for c in lost:
            lost_any = True
            print(f"   LOST U+{ord(c):04X} {c!r} — widen RANGES")
    if lost_any:
        sys.exit(1)


if __name__ == "__main__":
    if "--check" in sys.argv:
        check()
    else:
        build()
        check()
