"""
Transcribe deskewed page scans (pages/out/*.tif) into semantic Pandoc-Markdown,
one .md per page, using a vision LLM.

This is the transcription stage of the Raimbaut web-edition pipeline. The goal
is a *readable modern edition*: soft line-break hyphens are healed, obvious
typewriter slips left to the later proofing pass, but italics, footnotes,
superscripts, language of each passage, and page anchors are all preserved as
machine-readable markup.

TIFF is not accepted by vision APIs, so each page is loaded, converted to
grayscale, downscaled, and sent as an in-memory PNG.

Two backends share one convention (prompt + image prep); only the API call and
output dir differ, so the two passes can be diffed page-by-page for A/B checking.

Usage:
    python transcribe.py                              # all pages, OpenAI -> transcripts/
    python transcribe.py --only page-357              # one page
    python transcribe.py --skip-existing              # resume after failures
    python transcribe.py --backend anthropic          # Claude -> transcripts-claude/
    python transcribe.py --backend anthropic --model claude-opus-4-8 --only page-357

Requires OPENAI_API_KEY (openai backend) and/or ANTHROPIC_API_KEY (anthropic) in .env.
"""

import argparse
import base64
import io
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # deskewed TIFFs are large but trusted local files

SRC_DIR = Path("pages/out")
WORKERS = 6
MAX_LONG_SIDE = 3400  # near-full res; faint Occitan diacritics need the detail
MAX_TOKENS = 4096     # a single page never legitimately exceeds this; caps runaways

# Per-backend defaults. Both share the SYSTEM/USER prompt and image prep below;
# only the API call differs. Output dirs are kept separate so the two passes can
# be diffed page-by-page for the A/B accuracy check.
BACKENDS = {
    "openai":    {"model": "gpt-4o",         "out": "transcripts"},
    "anthropic": {"model": "claude-sonnet-5", "out": "transcripts-claude"},
}

# Set by main() once the backend is known; read by transcribe() in worker threads.
MODEL = None
OUT_DIR = None
CLIENT = None
BACKEND = None

SYSTEM = r"""You transcribe scanned pages of a 1982 PhD thesis (IBM Selectric
typescript) about the chansonnier of the troubadour Raimbaut d'Orange. The main
language is French, with quotations in Occitan (Old Provençal), German, English,
Latin and Italian. You output GitHub/Pandoc-flavored Markdown ONLY -- no code
fences around the whole answer, no commentary before or after.

Goal: a READABLE MODERN EDITION. Follow these rules exactly:

1. Reading order, top to bottom. Do NOT transcribe the printed page number in
   the corner (it is recorded separately).
0. NEVER emit runs of spaces, tabs, &nbsp; or &emsp; to visually align text, and
   never attempt to line up columns. Alignment is the renderer's job, not yours.
2. HEAL soft hyphenation: when a word is split across a line-break by a hyphen
   (e.g. "sédui-" / "sante"), rejoin it ("séduisante"). Keep genuine hyphens
   (e.g. "poète-amant", "Saint-Didier").
3. Italics -> *italic*. The Selectric italic face is used for Occitan/foreign
   quotations and for cited work titles; mark all of it.
4. Footnotes: a superscript reference number in the text -> [^N]. Transcribe the
   footnote body (below the horizontal rule) as [^N]: ... at the END of the
   output, in order. Do not emit the rule itself.
5. Other superscripts (not footnote refs): use Pandoc carets --
   folio "f°36v" -> f°36^v^ ; "XIIe siècle" -> XII^e^ siècle ; exponents in
   metrical schemes like a^1^a^2^.
6. Mark the language of every non-French passage:
   - inline: [quoted words]{lang=oc}   (codes: oc, de, en, la, it)
   - a whole block/quotation of foreign text: wrap in a fenced div
     ::: {lang=oc}
     ...
     :::
   French body text needs no marker.
7. Verse. Occitan verse strophes (the italic edited text) MUST be wrapped in a
   fenced verse div -- do NOT render them as loose italic lines. Do not italicize
   inside the div; the div already marks it as Occitan. One verse line per output
   line, preserving leading line numbers. Example:
   ::: {.verse lang=oc}
   25. Gran esforz fait Dieus, qar sofer
   c'ab si no la'npueja baisan!
   :::
   Prose translations that follow are normal paragraphs (not verse). NEVER drop a
   strophe/section marker ("IV.", "V.", "VI.") or a line number -- transcribe
   every one you see.
8. Underlined text (bibliographic sigla like Archiv, MG, RO, P.-C.) ->
   [Archiv]{.underline}.
8b. Rhyme/metrical schemes (e.g. rhyme letters over syllable counts) are NOT a
    table to align: put the rhyme letters on one line and the syllable counts on
    the next, single-spaced, e.g.
    - 853,1 : a b c d e a
      8 8 8 7'8 8
8c. Preserve the letter-case of proper names and sigla EXACTLY as printed. Author
    surnames set in full capitals (WETTSTEIN, BLOMME, CROPP) stay in capitals; do
    not normalize them to title case.
9. Editorial square brackets that the author printed in the text (e.g.
   [vous en auriez], [-bas]) are meaningful -- keep them as literal square
   brackets in the text.
10. Handwritten additions/corrections: apply the correction into the text, then
    append a marker [[hand: what was added/changed]] immediately after it. A
    hand-drawn diacritic that merely completes a letter should be applied
    silently (no marker).
11. If you genuinely cannot read a word, transcribe your best guess as
    [guess]{.unclear}.

Return only the Markdown."""

USER = "Transcribe this page. It is logical page: {label}."

load_dotenv()


def page_png_b64(path):
    img = Image.open(path).convert("L")
    w, h = img.size
    scale = MAX_LONG_SIDE / max(w, h)
    if scale < 1:
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def label_of(stem):
    """Human-readable logical page label from the filename stem."""
    s = stem.replace("page-", "")
    if s.startswith("title-"):
        return f"section title page ({s[6:]})"
    return s  # "016", "234a", "i", "ii"


def clean(md):
    """Strip a stray ```-fence wrapper and any page-anchor the model emitted."""
    md = md.strip()
    if md.startswith("```"):
        md = md.split("\n", 1)[1] if "\n" in md else ""
        if md.rstrip().endswith("```"):
            md = md.rstrip()[:-3]
    lines = [ln for ln in md.splitlines() if not ln.strip().startswith("<!-- page:")]
    return "\n".join(lines).strip()


def call_openai(b64, label):
    resp = CLIENT.chat.completions.create(
        model=MODEL, temperature=0, max_tokens=MAX_TOKENS,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": [
                {"type": "text", "text": USER.format(label=label)},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"}},
            ]},
        ],
    )
    return resp.choices[0].message.content or ""


def call_anthropic(b64, label):
    resp = CLIENT.messages.create(
        model=MODEL, max_tokens=MAX_TOKENS, temperature=0, system=SYSTEM,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64",
                                         "media_type": "image/png", "data": b64}},
            {"type": "text", "text": USER.format(label=label)},
        ]}],
    )
    return "".join(b.text for b in resp.content if b.type == "text")


def transcribe(path):
    """Return (stem, markdown) on success, or (stem, None, err) on failure."""
    try:
        b64 = page_png_b64(path)
        label = label_of(path.stem)
        call = call_anthropic if BACKEND == "anthropic" else call_openai
        body = clean(call(b64, label))
        return path.stem, f"<!-- page: {label} -->\n\n{body}\n"
    except Exception as e:  # isolate per-page failures so the batch continues
        return path.stem, None, repr(e)


def main():
    global MODEL, OUT_DIR, CLIENT, BACKEND
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="transcribe only these stems, e.g. page-016")
    ap.add_argument("--skip-existing", action="store_true",
                    help="skip pages that already have a transcript (resumable runs)")
    ap.add_argument("--backend", choices=BACKENDS, default="openai")
    ap.add_argument("--model", help="override the backend's default model")
    ap.add_argument("--out", help="override the output directory")
    args = ap.parse_args()

    BACKEND = args.backend
    MODEL = args.model or BACKENDS[BACKEND]["model"]
    OUT_DIR = Path(args.out or BACKENDS[BACKEND]["out"])
    if BACKEND == "anthropic":
        from anthropic import Anthropic
        CLIENT = Anthropic()
    else:
        from openai import OpenAI
        CLIENT = OpenAI()

    files = sorted(SRC_DIR.glob("page-*.tif"))
    if args.only:
        wanted = set(args.only)
        files = [f for f in files if f.stem in wanted]
    OUT_DIR.mkdir(exist_ok=True)
    if args.skip_existing:
        files = [f for f in files if not (OUT_DIR / f"{f.stem}.md").exists()]
    if not files:
        raise SystemExit("Nothing to do (no matching pages, or all already transcribed).")

    print(f"Transcribing {len(files)} page(s) with {MODEL}...")
    ok, failed = 0, []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for result in pool.map(transcribe, files):
            stem = result[0]
            if result[1] is None:
                failed.append((stem, result[2]))
                print(f"  {stem}: FAILED {result[2]}")
                continue
            (OUT_DIR / f"{stem}.md").write_text(result[1], encoding="utf-8")
            ok += 1
            print(f"  {stem}: {len(result[1])} chars")
    print(f"\nDone. {ok} ok, {len(failed)} failed.")
    if failed:
        print("Re-run with --skip-existing to retry the failures:")
        for stem, err in failed:
            print(f"  {stem}: {err}")


if __name__ == "__main__":
    main()
