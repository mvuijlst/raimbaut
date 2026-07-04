"""
Spell pass over the FRENCH PROSE of the edition (detection).

Aim: catch OCR typos like "manifete"->"manifeste" WITHOUT touching Occitan verse,
italic/lang=oc terms, foreign quotes, proper nouns or sigla. So before checking we
strip, per page:
  - verse / fenced divs         ::: … :::
  - italic spans                *…*        (titles, Occitan/foreign terms)
  - attribute spans             [x]{…}     (underlined sigla, lang spans)
  - footnote markers, page anchors, interpuncts

Then we tokenise, and flag a token only if ALL of:
  - lower-case, length >= 4, letters only (no digits/caps -> skips proper nouns)
  - unknown to the French dictionary
  - the checker's best correction differs and is at Levenshtein distance 1
  - that correction is itself a reasonably frequent French word

Output: spell-candidates-v2.csv (wrong, suggestion, count, sample). Detection only —
applying fixes is a separate, reviewed step (apply_spelling.py).
"""
import csv
import glob
import re
from collections import Counter, defaultdict
from spellchecker import SpellChecker

sp = SpellChecker(language="fr")
FREQ = sp.word_frequency
# the thesis quotes English/German/Italian/… scholarship heavily; a token valid in
# any of these is NOT a French OCR error. (No Latin dict — allowlist catches those.)
OTHER = [SpellChecker(language=l) for l in ("en", "de", "es", "it", "pt", "nl")]

# correct French / Occitan / scholarly terms the fr dictionary lacks (would else be
# "corrected" destructively: occitane->occitan, tenson->tension, …). Extend freely.
ALLOW = set("""
occitan occitane occitans occitanes occitane occitanes roman romane romans romanes
tenson tensons tenso tensos cobla coblas trobar trobador trobadors senhal senhals
canso cansos cansó vers razo razos sirventes sirventés fin'amor finamor domna midons
capcaudadas capfinidas unisonans doblas ternas singulars retrogradas dansa descort
occitanien émende émender émendé émendée topique topiques phonique phoniques rimaire
provençal provençale provençaux anaphorique tautologique hapax incipit codicologique
sing plur masc fém subj imparf trad chap éd fol suiv cfr ibid loc vol pl fasc col
""".split())

VERSE_DIV = re.compile(r"^\s*:::.*?$", re.M)
HAND = re.compile(r"\[\[[^\]]*\]\]")           # [[hand: …]] editorial annotations
ITALIC = re.compile(r"\*[^*]+\*")
ATTR_SPAN = re.compile(r"\[[^\]]*\]\{[^}]*\}")
FN_MARK = re.compile(r"\[\^[^\]]+\]:?")
ANCHOR = re.compile(r"<!--.*?-->")
SUP = re.compile(r"\^[^\s^]+\^")
WORD = re.compile(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*")


ALPHA = "abcdefghijklmnopqrstuvwxyzàâäçéèêëîïôöùûüœ"


def edits1(word):
    """All strings one edit (delete/transpose/replace/insert) from `word`."""
    splits = [(word[:i], word[i:]) for i in range(len(word) + 1)]
    out = set()
    for L, R in splits:
        if R:
            out.add(L + R[1:])                       # delete
        if len(R) > 1:
            out.add(L + R[1] + R[0] + R[2:])         # transpose
        for c in ALPHA:
            if R:
                out.add(L + c + R[1:])               # replace
            out.add(L + c + R)                       # insert
    return out


def best_edit1(word):
    """Highest-frequency dictionary word at edit distance 1, or None."""
    known = sp.known(edits1(word))
    known.discard(word)
    if not known:
        return None
    return max(known, key=lambda w: FREQ[w])


def prose_of(text):
    lines = []
    in_div = False
    for ln in text.split("\n"):
        s = ln.strip()
        if s.startswith(":::"):
            in_div = not (s == ":::") if not in_div else False
            in_div = s != ":::"
            continue
        if in_div:
            continue
        lines.append(ln)
    t = "\n".join(lines)
    t = ANCHOR.sub(" ", t)
    t = HAND.sub(" ", t)
    t = ATTR_SPAN.sub(" ", t)
    t = ITALIC.sub(" ", t)
    t = FN_MARK.sub(" ", t)
    t = SUP.sub(" ", t)
    t = t.replace("·", " ")
    return t


def main():
    counts = Counter()
    samples = {}
    pages = defaultdict(set)
    for f in sorted(glob.glob("corpus-v2/*.md")):
        pid = f.replace("\\", "/").split("/")[-1][:-3]
        prose = prose_of(open(f, encoding="utf-8").read())
        for m in WORD.finditer(prose):
            w = m.group(0)
            wl = w.lower()
            if w[0].isupper():
                continue                      # proper nouns / sentence starts
            core = wl.strip("'’-")
            if len(core) < 4 or not core.isalpha():
                continue
            if core in sp or wl in sp or core in ALLOW:
                continue
            if any(core in o for o in OTHER):     # valid in EN/DE/ES/IT/PT/NL -> a quote
                continue
            counts[core] += 1
            pages[core].add(pid)
            if core not in samples:
                a, b = max(0, m.start() - 30), m.end() + 25
                samples[core] = re.sub(r"\s+", " ", prose[a:b]).strip()

    rows = []
    for w, c in counts.items():
        sug = best_edit1(w)
        if sug and FREQ[sug] > FREQ[w]:
            rows.append((w, sug, c, sorted(pages[w])[0], len(pages[w]), samples[w]))
    rows.sort(key=lambda r: (-r[2], r[0]))

    with open("spell-candidates-v2.csv", "w", newline="", encoding="utf-8") as fh:
        wr = csv.writer(fh)
        wr.writerow(["wrong", "suggestion", "count", "first_page", "n_pages", "context"])
        wr.writerows(rows)

    print(f"{len(rows)} edit-distance-1 candidates -> spell-candidates-v2.csv")
    print("top candidates:")
    for w, sug, c, pid, npg, ctx in rows[:60]:
        print(f"  {c:3}x {w:18} -> {sug:18} ({pid}) {ctx[:44]}")


if __name__ == "__main__":
    main()
