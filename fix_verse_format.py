"""Normalize verse-line formatting in Claude verse transcripts.

Subagents sometimes write the leading verse-line number stuck to the word
("5.tan"); the edition convention is "5. tan". Fix ONLY inside ::: {.verse ...}
divs so prose/footnotes are untouched. Idempotent.

Usage: python fix_verse_format.py [file ...]   (default: all transcripts-v2-claude/*.md)
"""
import re
import sys
from pathlib import Path

LINE_NO = re.compile(r'^(\s*)(\d{1,2})\.(?=\S)')

def fix(text):
    out, in_verse = [], False
    for ln in text.splitlines():
        s = ln.strip()
        if s.startswith(':::') and '.verse' in s:
            in_verse = True
        elif s == ':::':
            in_verse = False
        elif in_verse:
            ln = LINE_NO.sub(r'\1\2. ', ln)
        out.append(ln)
    return '\n'.join(out) + ('\n' if text.endswith('\n') else '')

files = [Path(a) for a in sys.argv[1:]] or sorted(Path('transcripts-v2-claude').glob('*.md'))
changed = 0
for f in files:
    t = f.read_text(encoding='utf-8')
    nt = fix(t)
    if nt != t:
        f.write_text(nt, encoding='utf-8'); changed += 1
        print(f'  fixed {f.name}')
print(f'{changed}/{len(files)} files normalized')
