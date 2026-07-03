"""
Build chansons.json: the catalogue of the 22 edited chansons, extracted from the
transcripts. Each chanson has three sections in the thesis -- the incipit page
(with its Pillet-Carstens number), the REMARQUES (commentary), and the TEXTE ET
TRADUCTION (edited Occitan text + French translation) -- and this records the
page each section starts on, plus the derived page range of the whole chanson.

The Pillet-Carstens number (e.g. 389,22) is the stable identity of each poem and
the key we will align against published editions (Pattison "RO" / Rialto) in the
accuracy cross-check. Incipits are kept as transcribed (they carry the known
Occitan OCR noise) and are NOT authoritative.
"""

import json
import re
from pathlib import Path

TRANSCRIPTS = Path("transcripts")
OUT = Path("chansons.json")

# Sections whose header was garbled/dropped in transcription and so cannot be
# auto-detected. Verified by hand against the scans. (page to fix later noted.)
TEXTE_OVERRIDES = {
    "IX": "page-177",  # header dropped; texte begins "Car vei qe clars..." (389,38)
}

ROMAN = {r: i for i, r in enumerate(
    "I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII XVIII XIX XX XXI XXII".split(), 1)}
HEADER = re.compile(r"CHANSON\s+([IVXL]+)\s*:?\s*(.*)", re.I)
PC = re.compile(r"P\.?-?C\.?[^\d]*(\d{3})[,.](\d+)")


def page_key(stem):
    """Sort key so page-234a falls between page-234 and page-235."""
    m = re.match(r"page-(\d+)([a-z]?)", stem)
    if m:
        return (0, int(m.group(1)), m.group(2))
    return (1, 0, stem)  # roman/title pages sort after; not part of any chanson


def strip_md(line):
    return line.lstrip("#*->_ ").rstrip("*_ ").strip()


def classify(rest):
    up = rest.upper()
    if "REMARQUES" in up:
        return "remarques"
    if "TEXTE" in up:
        return "texte"
    return "incipit"


def main():
    # numbered body pages only, in reading order (234a between 234 and 235);
    # front-matter/title pages are never part of a chanson range
    body = sorted((p.stem for p in TRANSCRIPTS.glob("page-*.md")
                   if re.match(r"page-\d+[a-z]?$", p.stem)), key=page_key)
    order = {stem: i for i, stem in enumerate(body)}

    # collect every chanson header, grouped by page (order index)
    hits_by_idx = {}  # order_idx -> list of (roman, section, incipit_text, pc)
    for stem in body:
        text = (TRANSCRIPTS / f"{stem}.md").read_text(encoding="utf-8")
        for line in text.splitlines():
            m = HEADER.search(strip_md(line))
            if not m:
                continue
            roman, rest = m.group(1).upper(), m.group(2)
            if roman not in ROMAN:
                continue
            pc_m = PC.search(rest)
            pc = f"{pc_m.group(1)},{pc_m.group(2)}" if pc_m else None
            im = re.search(r"\*(.+?)\*", rest)
            incipit = im.group(1).replace("­", "") if im else None
            hits_by_idx.setdefault(order[stem], []).append(
                (roman, classify(rest), incipit, pc))

    # Skeleton: the REMARQUES header is unique per chanson and monotonic, so it
    # is the reliable anchor. Everything else is assigned by the window between
    # consecutive REMARQUES pages -- this ignores cross-references (which fall in
    # the wrong window) and survives a misread roman on a section header.
    remarques = {}  # roman -> order_idx (earliest, guarding OCR dups)
    for idx, hs in sorted(hits_by_idx.items()):
        for roman, section, _, _ in hs:
            if section == "remarques":
                remarques.setdefault(roman, idx)
    skeleton = sorted((idx, roman) for roman, idx in remarques.items())

    result = []
    for i, (rem_idx, roman) in enumerate(skeleton):
        nxt = skeleton[i + 1][0] if i + 1 < len(skeleton) else len(body)
        inc_idx = rem_idx - 1  # the incipit/title page precedes REMARQUES
        # pull pc + incipit text from the incipit page's header for this roman
        pc = incipit = None
        for r, sec, inc, p in hits_by_idx.get(inc_idx, []):
            if r == roman and sec == "incipit":
                pc, incipit = p, inc
        # texte header located inside this chanson's window (or hand override)
        texte = TEXTE_OVERRIDES.get(roman) or next(
            (body[j] for j in range(rem_idx + 1, nxt)
             if any(s == "texte" for _, s, _, _ in hits_by_idx.get(j, []))), None)
        sections = {"incipit": body[inc_idx], "remarques": body[rem_idx]}
        if texte:
            sections["texte"] = texte
        end_idx = (skeleton[i + 1][0] - 2) if i + 1 < len(skeleton) else len(body) - 1
        result.append({
            "chanson": roman, "number": ROMAN[roman], "pc": pc, "incipit": incipit,
            "sections": sections,
            "page_start": body[inc_idx], "page_end": body[max(inc_idx, end_idx)],
            "missing_sections": [] if texte else ["texte"],
        })

    result.sort(key=lambda c: c["number"])
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(result)} chansons -> {OUT}\n")
    for c in result:
        secs = " ".join(f"{k}={v}" for k, v in c["sections"].items())
        print(f"  {c['chanson']:>5}  P-C {c['pc'] or '???':<8} "
              f"{c['page_start']}..{c['page_end']}  [{secs}]")


if __name__ == "__main__":
    main()
