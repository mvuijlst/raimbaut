"""
Normalize footnote-marker transcription artifacts in the corpus, in place.

Three safe, pattern-based fixes (every change is logged to
corrections-footnotes.csv for audit):

  1. trailing-caret token   [^N^]  ->  [^N]
     A footnote marker that leaked a literal superscript caret. Applies to both
     references and definitions; the label is purely numeric so there is no
     ambiguity with a real footnote whose name ends in '^'.

  2. plain-bracket ref       [N]   ->  [^N]   (running text only)
     A reference that lost its caret, transcribed as an ordinary bracket. Only
     rewritten when the same page carries a [^N]: definition and no [^N]
     reference already — i.e. exactly the marker that def is waiting for.

We deliberately do NOT touch bare superscripts like ^1^ automatically: ^2^ is
indistinguishable by regex from ordinals (2^e^) and manuscript sigla (N^2^),
so those few cases are handled by hand.

Genuinely dropped markers (definition present, no marker anywhere in the body)
are NOT invented here — they are left for scan-based recovery and reported.
"""

import csv
import re
from pathlib import Path

CORPUS = Path("corpus")
LOG = Path("corrections-footnotes.csv")

CARET_TOKEN = re.compile(r"\[\^(\d+)\^\]")            # [^2^]
DEF_LINE = re.compile(r"^\[\^([^\]]+)\]:", re.M)
FNREF = re.compile(r"\[\^(\d+)\](?!:)")               # [^2] not a def
PLAIN = re.compile(r"(?<!\^)\[(\d+)\](?!:)")          # [2], not [^2] and not [2]:

changes = []
for md in sorted(CORPUS.glob("page-*.md")):
    text = orig = md.read_text(encoding="utf-8")

    # fix 1: strip trailing caret inside numeric footnote tokens
    for m in CARET_TOKEN.finditer(text):
        changes.append((md.stem, "caret-token", f"[^{m.group(1)}^]", f"[^{m.group(1)}]"))
    text = CARET_TOKEN.sub(r"[^\1]", text)

    # fix 2: promote plain-bracket refs whose definition sits on this page
    def_labels = set(DEF_LINE.findall(text))
    ref_labels = set(FNREF.findall(text))
    for m in list(PLAIN.finditer(text)):
        n = m.group(1)
        if n in def_labels and n not in ref_labels:
            changes.append((md.stem, "plain-bracket-ref", f"[{n}]", f"[^{n}]"))
    # rewrite only the qualifying plain brackets
    def promote(m):
        n = m.group(1)
        return f"[^{n}]" if (n in def_labels and n not in ref_labels) else m.group(0)
    text = PLAIN.sub(promote, text)

    if text != orig:
        md.write_text(text, encoding="utf-8")

with LOG.open("w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["page", "kind", "from", "to"])
    w.writerows(changes)

by_kind = {}
for _, k, *_ in changes:
    by_kind[k] = by_kind.get(k, 0) + 1
print(f"{len(changes)} footnote-marker fixes across corpus:")
for k, n in sorted(by_kind.items()):
    print(f"  {k}: {n}")
print(f"logged -> {LOG}")
