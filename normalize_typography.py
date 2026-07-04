"""
Typography normalization for the readable web edition (post-merge step).

Pipeline order: merge_corpus_v2.py  ->  normalize_typography.py  (both write corpus-v2/).
Idempotent: re-running on already-normalized text is a no-op.

Per user's locked editorial decisions (2026-07-04):
  1. REFLOW prose paragraphs. gpt-4o kept the typescript's physical line breaks on
     many pages; join each blank-line-separated block into one logical line.
       line ends in soft hyphen (letter + "-")  -> join, drop hyphen  (logged for audit)
       otherwise                                -> join with one space
     Fenced divs (::: ... :::, incl. .verse) and the <!-- page --> anchor pass through
     UNCHANGED so verse line structure + hemistich gaps survive. Each footnote def
     ([^N]:) starts its own block so adjacent defs never merge.
  2. Collapse double+ spaces to one  (PROSE only).
  3. " - " -> " — " (spaced em dash), EXCEPT between two capitals (spaced compounds
     like AVANT - PROPOS, proper pairs) which are left as-is.
  4. Space before ; : ! ? -> U+202F NNBSP; guillemets «·» get inside NNBSP.
  5. Stacked "+" section breaks -> a single "⁂" asterism paragraph.

Punctuation (2-4) also applies inside divs (no reflow there); double-space collapse
is prose-only so verse hemistich gaps survive.
"""
import csv
import glob
import re

NNBSP = " "
EMDASH = "—"
ASTERISM = "⁂"
FN_START = re.compile(r"^\[\^[^\]]+\]:")
SOFT_HYPHEN_END = re.compile(r"[0-9A-Za-zà-ÿÀ-ß]-$")

joins_log = []


def _dash(m):
    b, a = m.group(1), m.group(2)
    if b.isupper() and a.isupper():
        return m.group(0)          # spaced compound / proper pair -> leave
    return f"{b} {EMDASH} {a}"


def punct(s, collapse_dbl):
    s = re.sub(r"\[\^(\d+)\^\]", r"[^\1]", s)   # gpt-4o caret artifact [^2^] -> [^2]
    if collapse_dbl:
        s = re.sub(r" {2,}", " ", s)
    s = re.sub(r"(\S) - (\S)", _dash, s)
    s = re.sub(r" ([;:!?])", NNBSP + r"\1", s)
    s = s.replace("« ", "«" + NNBSP).replace(" »", NNBSP + "»")
    return s


def reflow_block(block, pageid):
    s = ""
    for ln in block:
        ln = ln.strip()
        if not ln:
            continue
        if not s:
            s = ln
        elif SOFT_HYPHEN_END.search(s):
            joins_log.append((pageid, s[-24:], (s[:-1] + ln)[max(0, len(s) - 24):len(s) + 10]))
            s = s[:-1] + ln
        else:
            s = s + " " + ln
    return s


def normalize(text, pageid):
    lines = text.split("\n")
    # asterism pre-pass
    out0, i = [], 0
    while i < len(lines):
        if re.match(r"^\s*\+\s*$", lines[i]):
            j, plus = i, 0
            while j < len(lines) and (re.match(r"^\s*\+\s*$", lines[j]) or not lines[j].strip()):
                if lines[j].strip() == "+":
                    plus += 1
                j += 1
            if plus >= 1:          # a lone "+" line is a section-break ornament
                out0 += ["", ASTERISM, ""]; i = j; continue
        out0.append(lines[i]); i += 1
    lines = out0

    out, in_div, para = [], False, []

    def flush():
        if para:
            out.append(punct(reflow_block(para, pageid), collapse_dbl=True))
            para.clear()

    for ln in lines:
        s = ln.strip()
        if s.startswith("<!-- page:"):
            flush(); out.append(ln)
        elif s.startswith(":::"):
            flush(); out.append(ln)
            in_div = (s != ":::")           # "::: {...}" opens, bare ":::" closes
        elif in_div:
            out.append(punct(ln, collapse_dbl=False))
        elif s == ASTERISM or s == "":
            flush(); out.append(ln if s else "")
        elif FN_START.match(s):
            flush(); para.append(ln)        # each footnote def starts a fresh block
        else:
            para.append(ln)
    flush()

    txt = re.sub(r"\n{3,}", "\n\n", "\n".join(out))
    return txt.strip() + "\n"


def main():
    files = sorted(glob.glob("corpus-v2/*.md"))
    changed = 0
    for f in files:
        pageid = f.replace("\\", "/").split("/")[-1][:-3]
        t = open(f, encoding="utf-8").read()
        nt = normalize(t, pageid)
        if nt != t:
            open(f, "w", encoding="utf-8").write(nt); changed += 1
    with open("corrections-reflow-v2.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); w.writerow(["pageid", "before(...-)", "after(joined)"])
        w.writerows(joins_log)
    print(f"normalized {changed}/{len(files)} files; "
          f"{len(joins_log)} soft-hyphen joins logged -> corrections-reflow-v2.csv")


if __name__ == "__main__":
    main()
