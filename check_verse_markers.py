"""
Audit the verse numbering of the 39 chansons (stdlib only; run by `manage.py verify`).

The reading view numbers verses by counting lines and re-anchoring on every printed
marker of the typescript ("45. qu'es vilans…"). So between two printed markers the
number of verse lines must equal the difference of the markers. Where it does not, a
verse was split, merged or dropped in transcription, a typewriter-wrapped line is being
counted as a verse — or the typescript itself is irregular, in which case the place
belongs in verse-numbering.json (hand-authored, with the reason), which this script
and site/lib/chanson.js both honour:

    ignore_printed     printed markers the typescript misplaced: counted through
    unnumbered_after   the typed line after verse N is not a verse (a bracketed variant)

Exit 1 and list every anomaly; silent success otherwise.
"""
import io
import json
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
LINE_NO = re.compile(r"^\s*(\d+)\s*[.·]\s+(\S.*)$")          # same shape as chanson.js
VERSE_DIV = re.compile(r"^:::\s*\{[^}]*lang=oc[^}]*\}\s*\n(.*?)^:::\s*$", re.S | re.M)

chansons = json.load(open("chansons.json", encoding="utf-8"))
overrides = json.load(open("verse-numbering.json", encoding="utf-8"))
problems = 0
for c in chansons:
    ov = overrides.get(c["roman"], {})
    ignore, unnumbered = set(ov.get("ignore_printed", [])), set(ov.get("unnumbered_after", []))
    no, anchor_no, since_anchor, prev_variant = 0, 0, 0, False
    for pid in (c.get("texte") or {}).get("pages", []):
        text = open(f"corpus/{pid}.md", encoding="utf-8").read()
        for block in VERSE_DIV.findall(text):
            for line in block.split("\n"):
                if not line.strip() or line.strip().startswith("[[hand"):
                    continue
                m = LINE_NO.match(line)
                if not m and no in unnumbered and not prev_variant:
                    prev_variant = True
                    continue
                prev_variant = False
                since_anchor += 1
                printed = int(m.group(1)) if m else None
                if printed is None or printed in ignore:
                    no += 1
                    continue
                if printed - anchor_no != since_anchor:
                    problems += 1
                    print(f"{c['roman']:8} {pid}  printed {anchor_no} -> {printed}: "
                          f"{since_anchor} verse lines for {printed - anchor_no} numbers   «{m.group(2)[:48]}»")
                no = anchor_no = printed
                since_anchor = 0
if problems:
    print(f"\n{problems} verse-numbering anomal{'y' if problems == 1 else 'ies'} — fix the corpus, or "
          f"record the typescript's irregularity in verse-numbering.json")
    sys.exit(1)
print(f"verse markers consistent in all {len(chansons)} chansons")
