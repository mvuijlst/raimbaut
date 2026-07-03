"""
Extract the citation / abbreviation apparatus into citations.json -- the
foundation for the web edition's hyperlinked sources.

The thesis has no standalone abbreviations page; instead it defines each siglum
inline at first use with "...full citation... (ci-après [RO]{.underline})".
So we:
  1. harvest those "ci-après" definitions -> the abbreviation key (siglum -> work)
  2. tally every underlined siglum's usage (count + pages) as link targets
  3. flag sigla that are USED but never defined via ci-après (need resolving
     from standard reference works / the print edition)

Output: citations.json { abbreviations[], usage[], unresolved[] }
"""

import json
import re
from pathlib import Path

MANIFEST = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
OVERRIDES = json.loads(Path("sigla-overrides.json").read_text(encoding="utf-8"))
OUT = Path("citations.json")

# a ci-après siglum can be marked as [X]{.underline}, [X], or *X*
CIAPRES = re.compile(
    r"\(ci-apr[eè]s\s+(?:\[(?P<u>[^\]]+)\]\{\.underline\}|\*(?P<i>[^*]+)\*|\[(?P<b>[^\]]+)\])\)")
UNDERLINE = re.compile(r"\[([^\]]+)\]\{\.underline\}")
FOOTNOTE_START = re.compile(r"\[\^[^\]]+\]:")


def looks_like_siglum(tok):
    """Heuristic: short, starts uppercase, no spaces -> a reference siglum
    (filters out emphasis-underlined ordinary words/phrases)."""
    return (len(tok) <= 9 and " " not in tok and tok[:1].isupper()
            and not tok.isalpha() or (tok.isupper() and tok.isalpha())
            or bool(re.fullmatch(r"[A-Z][A-Za-z]{0,3}\.?(-[A-Z]\.?)?", tok)))


def preceding_citation(text, at):
    """The work being abbreviated sits just before '(ci-après …)'. Take the
    text from the nearest preceding ';' or footnote start up to `at`."""
    window = text[max(0, at - 400):at]
    cut = max(window.rfind(";"), max((m.end() for m in FOOTNOTE_START.finditer(window)), default=-1))
    seg = window[cut + 1:] if cut >= 0 else window
    return re.sub(r"\s+", " ", seg).strip(" .,-")


abbr = {}       # siglum -> {definition, page}
usage = {}      # siglum -> {count, pages:set}

for m in MANIFEST:
    text = Path(m["file"]).read_text(encoding="utf-8")
    label = m["label"]

    for cm in CIAPRES.finditer(text):
        sig = cm.group("u") or cm.group("i") or cm.group("b")
        if sig not in abbr:
            abbr[sig] = {"siglum": sig, "definition": preceding_citation(text, cm.start()),
                         "defined_on_page": label}

    for um in UNDERLINE.finditer(text):
        tok = um.group(1)
        if looks_like_siglum(tok):
            u = usage.setdefault(tok, {"siglum": tok, "count": 0, "pages": set()})
            u["count"] += 1
            u["pages"].add(label)

# --- fold transcription-variant sigla into their canonical form ------------
# (e.g. PDF->PDP, FEM->FEW): merge usage counts/pages so links point at one entry.
alias_of = {a["siglum"]: a["alias_of"] for a in OVERRIDES.get("aliases", [])}
for variant, canon in alias_of.items():
    if variant in usage:
        v = usage.pop(variant)
        c = usage.setdefault(canon, {"siglum": canon, "count": 0, "pages": set()})
        c["count"] += v["count"]
        c["pages"] = set(c.get("pages", [])) | set(v["pages"])
    abbr.pop(variant, None)   # drop the variant's (mis-captured) auto definition

# --- apply curated definitions (verified + cleaned) ------------------------
# resolved: sigla the ci-après harvester missed; cleaned: fix noisy auto text;
# resolved_via_alias: the canonical entry a variant folded into.
for group in ("resolved", "cleaned", "resolved_via_alias"):
    for e in OVERRIDES.get(group, []):
        abbr[e["siglum"]] = {
            "siglum": e["siglum"],
            "definition": e["definition"],
            "defined_on_page": abbr.get(e["siglum"], {}).get("defined_on_page"),
            "source": "manual",
            "confidence": e.get("confidence", "high"),
        }

# manuscript sigla are not works — tag them so the renderer links to a ms. list
ms = OVERRIDES.get("manuscript_sigla", {})
ms_set = set(ms.get("singletons", [])) | set(ms.get("groups_seen", [])) | {"N²", "N2", "NN", "NN²"}

for u in usage.values():
    u["pages"] = sorted(u["pages"], key=lambda p: (len(p), p))

usage_list = sorted(usage.values(), key=lambda u: -u["count"])
defined = set(abbr)
unresolved = sorted((u["siglum"] for u in usage_list
                     if u["siglum"] not in defined and u["count"] >= 3
                     and u["siglum"] not in ms_set),
                    key=lambda s: -usage[s]["count"])

OUT.write_text(json.dumps({
    "abbreviations": sorted(abbr.values(), key=lambda a: a["siglum"]),
    "manuscript_sigla": ms,
    "aliases": OVERRIDES.get("aliases", []),
    "flagged_uncertain": OVERRIDES.get("flagged_uncertain", []),
    "usage": usage_list,
    "unresolved": unresolved,
}, ensure_ascii=False, indent=2), encoding="utf-8")

manual = sum(1 for a in abbr.values() if a.get("source") == "manual")
print(f"{len(abbr)} abbreviations ({manual} curated, {len(abbr)-manual} auto via 'ci-après'):")
for a in sorted(abbr.values(), key=lambda a: a["siglum"]):
    tag = "*" if a.get("source") == "manual" else " "
    print(f" {tag}{a['siglum']:10}: {a['definition'][:66]}")
print(f"\n{len(usage_list)} distinct sigla used. Still UNDEFINED (>=3x, non-ms.):")
print("  " + (", ".join(f"{s}({usage[s]['count']})" for s in unresolved) or "(none)"))
