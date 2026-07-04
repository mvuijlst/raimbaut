"""
Citation / abbreviation apparatus for the 2026 edition -> citations.json.

Consumes corpus-v2 (via manifest_v2.json, pageid IDs) and bibliography.json
(the REAL vol2 bibliography, which the old footnote-only harvest never had).

The thesis has no abbreviations page; each siglum is defined inline at first use
as "...full citation... (ci-après X)", where X may be bracketed+underlined
([RVO]{.underline}), bracketed ([P.-C.]), italic (*Leys*), or bare (RO, ANG, LR).
This fresh transcription uses siglum forms that differ from the old corpus
(RVO not RvO, TOB not TL, PDL cleanly defined, GOD, LTF, REW) -> we harvest them
from the text rather than trusting the stale v1 sigla-overrides.

We:
  1. harvest each "(ci-après X)" -> siglum + the full citation preceding it
  2. cross-link that siglum to a bibliography.json entry (author + title match)
  3. tally every underlined siglum's usage (count + pages) as link targets
  4. flag sigla USED but never defined (need resolving), excluding manuscript sigla

Output: citations.json { abbreviations[], manuscript_sigla, usage[], unresolved[] }
"""
import json
import re
import unicodedata
from pathlib import Path

MANIFEST = json.loads(Path("manifest_v2.json").read_text(encoding="utf-8"))
BIB = json.loads(Path("bibliography.json").read_text(encoding="utf-8"))
OVERRIDES = json.loads(Path("sigla-overrides.json").read_text(encoding="utf-8"))
OUT = Path("citations.json")

# "ci-après" (optionally italicised) then the siglum in any of its four dresses.
CIAPRES = re.compile(
    r"ci-apr[eè]s\*?\s+"
    r"(?:\[)?(?:\*)?(?P<sig>[A-Za-z][A-Za-z0-9.\-]*)(?:\*)?(?:\])?(?:\{\.underline\})?")
UNDERLINE = re.compile(r"\[([^\]]+)\]\{\.underline\}")
FN_START = re.compile(r"\[\^[^\]]+\]:")
CAP, LOW = r"[A-ZÀ-ÖØ-Þ]", r"[a-zà-öø-ÿ]"
GIVEN = rf"(?:{CAP}(?:{LOW}+|\.)\s*|{CAP}\.-?{CAP}?\.?\s*)*"
SURNAME = rf"{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\.\-]+"
AUTHOR = rf"{GIVEN}{SURNAME}(?:(?:\s+(?:et|E\.|and)\s+|\s*,\s*)?{GIVEN}{SURNAME})*"
CITATION = re.compile(rf"(?P<full>(?P<author>{AUTHOR})\s*,\s*(?:\*(?P<t1>[^*]+)\*|'(?P<t2>[^']{{4,}})'))")
SURTOK = re.compile(rf"{CAP}{CAP}[A-ZÀ-ÖØ-Þ'’\.\-]+")
TITLE = re.compile(r"\*(?P<t1>[^*]+)\*|'(?P<t2>[^']{4,})'")
LEAD = re.compile(r"^(?:Pour\b.*?\bvoir\s+|Voir\s+(?:aussi\s+|e\.a\.\s+|à ce propos\s+)?|"
                  r"Cfr?\.?\s+|Voyez\s+|C'est ce que\s+)+", re.I)
V2_ALIAS = {"RVO": "RvO",   # this transcription capitalises the ci-après form of RvO
            "LPD": "PDL"}   # Levy Petit Dict., scrambled; cited by page like PDL (v1p056/296)
SIGLUM_STOP = {"C.R.", "N.B.", "P.S.", "N.D.", "N.D.L.R."}   # French abbrevs., not sigla

# journals used (vol+page style) but never ci-après-defined and absent from the
# works bibliography; expanded from standard reference knowledge, evidence noted.
CURATED_V2 = {
    "MLN":  ("*Modern Language Notes*, Baltimore, Johns Hopkins Univ. Press.",
             "cited by vol.+page, e.g. « CHAMBERS, MLN, LX, 475 »"),
    "RPh":  ("*Romance Philology*, Berkeley, Univ. of California Press.",
             "cited by vol.+page, e.g. « RPh, VII, 234 »"),
    "CCM":  ("*Cahiers de Civilisation Médiévale*, Poitiers.",
             "« dans CCM, XXII (1979), pp.37… »"),
    "ZFSL": ("*Zeitschrift für französische Sprache und Literatur*, Wiesbaden.", ""),
}


# ---- hand-curated canonical siglum definitions ----------------------------
# The ci-après harvest captures everything before "(ci-après X)", so a definition
# inherits the incidental page range cited at first use (RO "pp.3-30", RvO
# "pp.62-98", P.-C. "pp.XXIX-XXXV" …), plus the odd OCR typo (RO "PATTERSON" for
# Pattison) or truncation artifact (GOD trailing "[", PDL "p.54 (*"). A siglum
# stands for the WORK, not for those pages, so these are hand-cleaned. Only the
# displayed `definition` string is replaced; the bibliography cross-link (set from
# the surname, which was already correct) is kept. Substance/works unchanged —
# incidental locators dropped, names spelled correctly.
CURATED_DEFS = {
    "RO":   "Walter T. PATTISON, *The Life and Works of the Troubadour Raimbaut "
            "d'Orange*, Minneapolis, The University of Minnesota Press, 1952.",
    "RvO":  "Carl APPEL, *Raimbaut von Orange*, Berlin, Weidmannsche Buchhandlung, 1928.",
    "P.-C.": "A. PILLET et H. CARSTENS, *Bibliographie der Troubadours*, Halle, 1933.",
    "PAT":  "Linda M. PATERSON, *Troubadours and Eloquence*, Oxford, At The Clarendon "
            "Press, 1975.",
    "LR":   "M. RAYNOUARD, *Lexique roman ou Dictionnaire de la langue des troubadours "
            "comparée avec les autres langues romanes*, Paris, 1836-1845 (réimpr. "
            "Heidelberg, Carl Winter).",
    "Leys": "*Las Flors del Gay Saber, estier dichas La Leys d'Amors*, traduction de "
            "MM. d'AGUILAR et d'ESCOULOUBRE, revue et complétée par M. GATIEN-ARNOULT, "
            "Toulouse, J.B. Paya, 1841-1843, 3 vols.",
    "PDL":  "Emil LEVY, *Petit Dictionnaire provençal-français*, Heidelberg, Carl "
            "Winter Verlag — Universitätsverlag, 1966 (4e éd.).",
    "TOB":  "A. TOBLER et E. LOMMATZSCH, *Altfranzösisches Wörterbuch*.",
    "GOD":  "Frédéric GODEFROY, *Dictionnaire de l'ancienne langue française et de "
            "tous ses dialectes du IXe au XVe siècle*, Vaduz, Kraus Reprint, 1965 "
            "(réimpr. de la 1re éd., Paris, 1880-1902).",
    "REW":  "Wilhelm MEYER-LÜBKE, *Romanisches Etymologisches Wörterbuch*, Heidelberg, "
            "1930-1932 (3e éd.).",
}


def keyify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def looks_like_siglum(tok):
    """short, capitalised, spaceless -> a reference siglum (not an emphasised word)."""
    if " " in tok or len(tok) > 9 or not tok[:1].isupper():
        return False
    return (tok.isupper() or "." in tok
            or bool(re.fullmatch(r"[A-Z][A-Za-z]{0,3}\.?(-[A-Z]\.?)?", tok)))


def preceding_citation(text, at):
    """The abbreviated work sits just before '(ci-après …)'. Clip to the current
    footnote first (never anchor on a previous note's citation), then anchor on
    the author+title citation nearest before `at`. If the note's own citation has
    an unbalanced italic (a real gpt-4o artifact, e.g. RAYNOUARD/LR on v1p044),
    no citation parses -> fall back to the clipped-window text."""
    window = text[max(0, at - 600):at]
    fns = list(FN_START.finditer(window))
    if fns:
        window = window[fns[-1].end():]
    cits = list(CITATION.finditer(window))
    if cits:
        seg = window[cits[-1].start():]
    else:
        cut = window.rfind("; ")
        seg = window[cut + 1:] if cut >= 0 else window
    seg = re.sub(r"\s+", " ", seg.rstrip(" (—-")).strip(" .,-—")
    return LEAD.sub("", seg).strip(" .,-—")


# ---- index the bibliography for cross-linking -----------------------------
bib_index = []       # (surname_key, title_key, entry-ref)
bib_by_siglum = {}   # lower(siglum) -> entry-ref  (bibliography's own siglum tags)
for section in ("general", "raimbaut"):
    for e in BIB[section]:
        ref = {"section": section, "author": e["author"], "title": e["title"], "page": e["page"]}
        if e["author"]:
            bib_index.append((keyify(e["author"]), keyify(e["title"])[:40], ref))
        sg = (e.get("siglum") or "").strip()
        # keep only plausible sigla (short, no spaces, real author) — the
        # bibliography's siglum field also caught journal names, "compte rendu"
        # (C.R.) and bare author-surname fragments (GHIL/GRUBER/GUIRAUD) we ignore
        if (sg and e["author"] and " " not in sg and len(sg) <= 9 and sg[:1].isupper()
                and sg not in SIGLUM_STOP and keyify(sg) != keyify(e["author"])):
            bib_by_siglum.setdefault(sg.lower(), ref)


def link_bibliography(definition, siglum=None):
    """Link a siglum to a bibliography entry: by the bibliography's own siglum
    tag first (robust to OCR name variants like PATTERSON/PATTISON), else by the
    definition's surname (+ title overlap when the surname is ambiguous)."""
    if siglum and siglum.lower() in bib_by_siglum:
        return bib_by_siglum[siglum.lower()]
    surs = SURTOK.findall(definition or "")
    tm = TITLE.search(definition or "")
    tkey = keyify(tm.group("t1") or tm.group("t2"))[:40] if tm else ""
    for sur in surs:
        sk = keyify(sur)
        cands = [b for b in bib_index if b[0] == sk]
        if not cands:
            continue
        if len(cands) == 1:
            return cands[0][2]
        return max(cands, key=lambda b: len(set(b[1]) & set(tkey)) if tkey else 0)[2]
    return None


# ---- harvest ci-après definitions + usage ---------------------------------
abbr = {}       # siglum -> {siglum, definition, defined_on_page, bib?}
usage = {}      # siglum -> {siglum, count, pages:set}

for m in MANIFEST:
    text = Path(m["file"]).read_text(encoding="utf-8")
    page = m["pageid"]
    for cm in CIAPRES.finditer(text):
        sig = cm.group("sig")
        if sig.lower() in ("ci",):
            continue
        sig = V2_ALIAS.get(sig, sig)
        if sig not in abbr:
            defn = preceding_citation(text, cm.start())
            abbr[sig] = {"siglum": sig, "definition": defn, "defined_on_page": page,
                         "printed": m["printed"], "source": "ci-après"}
    for um in UNDERLINE.finditer(text):
        tok = V2_ALIAS.get(um.group(1), um.group(1))
        if looks_like_siglum(tok):
            u = usage.setdefault(tok, {"siglum": tok, "count": 0, "pages": set()})
            u["count"] += 1
            u["pages"].add(page)

# cross-link each abbreviation to a bibliography entry
for a in abbr.values():
    tgt = link_bibliography(a["definition"], a["siglum"])
    if tgt:
        a["bibliography"] = tgt

# apply hand-curated definitions (override the noisy ci-après snapshot; keep the link)
for sig, defn in CURATED_DEFS.items():
    if sig in abbr:
        abbr[sig]["definition"] = defn
        abbr[sig]["curated_definition"] = True

# ---- fold curated overrides for sigla ci-après didn't reach ---------------
# Only apply an override if the siglum is actually USED in v2 and not already
# ci-après-defined (the v1 override forms are partly stale: PDP/TL/RvO etc.).
for group in ("resolved", "resolved_via_alias"):
    for e in OVERRIDES.get(group, []):
        s = e["siglum"]
        if s in usage and s not in abbr:
            abbr[s] = {"siglum": s, "definition": e["definition"],
                       "defined_on_page": None, "source": "curated",
                       "confidence": e.get("confidence", "high")}
            tgt = link_bibliography(e["definition"])
            if tgt:
                abbr[s]["bibliography"] = tgt

# ---- fill used-but-undefined sigla from the bibliography's own siglum tags -
# (e.g. FEW = von Wartburg: heavily used, but defined via bibliography not ci-après)
for tok, u in usage.items():
    if tok not in abbr and tok.lower() in bib_by_siglum:
        ref = bib_by_siglum[tok.lower()]
        abbr[tok] = {"siglum": tok,
                     "definition": f"{ref['author']}, {ref['title']}",
                     "defined_on_page": None, "source": "bibliography",
                     "bibliography": ref}

# ---- curated journal definitions for used-but-undefined sigla -------------
for s, (defn, ev) in CURATED_V2.items():
    if s in usage and s not in abbr:
        abbr[s] = {"siglum": s, "definition": defn, "defined_on_page": None,
                   "source": "curated", "confidence": "high",
                   **({"evidence": ev} if ev else {})}

# ---- manuscript sigla (not works) -----------------------------------------
ms = OVERRIDES.get("manuscript_sigla", {})
ms_set = set(ms.get("singletons", [])) | set(ms.get("groups_seen", [])) | {"N²", "N2", "NN", "NN²"}

for u in usage.values():
    u["pages"] = sorted(u["pages"], key=lambda p: (len(p), p))
usage_list = sorted(usage.values(), key=lambda u: -u["count"])

defined = set(abbr)
unresolved = sorted((u["siglum"] for u in usage_list
                     if u["siglum"] not in defined and u["count"] >= 3
                     and u["siglum"] not in ms_set and u["siglum"] not in SIGLUM_STOP),
                    key=lambda s: -usage[s]["count"])

OUT.write_text(json.dumps({
    "abbreviations": sorted(abbr.values(), key=lambda a: a["siglum"]),
    "manuscript_sigla": ms,
    "usage": usage_list,
    "unresolved": unresolved,
}, ensure_ascii=False, indent=2), encoding="utf-8")

linked = sum(1 for a in abbr.values() if a.get("bibliography"))
curated = sum(1 for a in abbr.values() if a.get("source") == "curated")
print(f"{len(abbr)} abbreviations ({curated} curated, {linked} linked to bibliography):")
for a in sorted(abbr.values(), key=lambda a: a["siglum"]):
    b = a.get("bibliography")
    tag = "->" + b["author"][:16] if b else "  (no bib link)"
    print(f"  {a['siglum']:9}: {a['definition'][:52]:52} {tag}")
print(f"\n{len(usage_list)} distinct sigla used. UNDEFINED (>=3x, non-ms.): "
      + (", ".join(f"{s}({usage[s]['count']})" for s in unresolved) or "(none)"))
