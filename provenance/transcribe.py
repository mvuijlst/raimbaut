"""
Transcribe page images rendered from the high-quality 3-volume source PDFs into
semantic Pandoc-Markdown, one .md per page, using a vision LLM.

This is the transcription stage of the Raimbaut web-edition pipeline. The goal
is a *readable modern edition*: soft line-break hyphens are healed, obvious
typewriter slips left to the later proofing pass, but italics, footnotes,
superscripts, language of each passage, and page anchors are all preserved as
machine-readable markup.

SOURCE (2026, "much better quality" scans): three PDFs in the repo root, each a
scan with a (poor) OCR text layer we ignore. Pages are rendered fresh with
PyMuPDF at 300 DPI -- far cleaner than the old pages/out/*.tif deskews.
  vol1 (…311): pp.1-292 approx      -> transcribe
  vol2 (…313): pp.293-580 approx    -> transcribe
  vol3 (…314): ANNEX = manuscript photocopies -> DO NOT OCR (excluded here).

Page IDs are decoupled from the printed page number (the text layer's numbers
are unreliable): the stable ID is v{vol}p{pdf_index:03d} (reading order is
guaranteed by PDF page order). The printed number is resolved separately, as
metadata, by ocr_page_numbers.py on corner crops.

Two backends share one convention (prompt + image prep); only the API call and
output dir differ. Per the hybrid strategy, gpt-4o does the bulk French prose;
the Occitan/verse pages are overlaid from Claude (done in-session, not this API).

Usage:
    python transcribe.py                              # all vol1+vol2 pages -> transcripts-v2/
    python transcribe.py --only v1p005 v2p002         # specific pages
    python transcribe.py --vol 1                       # one volume
    python transcribe.py --skip-existing              # resume after failures

Requires OPENAI_API_KEY in .env.
"""

import argparse
import base64
import io
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import fitz  # PyMuPDF
from dotenv import load_dotenv
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

# Volumes to transcribe (vol3 annex deliberately absent).
PDFS = {
    1: "910001066311_2024_0001_AC.pdf",
    2: "910001066313_2024_0001_AC.pdf",
}
RENDER_DPI = 300
WORKERS = 6
MAX_LONG_SIDE = 3400  # near-full res; faint Occitan diacritics need the detail
MAX_TOKENS = 4096     # a single page never legitimately exceeds this; caps runaways

BACKENDS = {
    "openai":    {"model": "gpt-4o",          "out": "transcripts-v2"},
    "anthropic": {"model": "claude-sonnet-5", "out": "transcripts-v2-claude"},
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


def render_page(vol, idx):
    """Render one PDF page to a grayscale PIL image at RENDER_DPI.

    Opens the document per call: PyMuPDF Documents are not safe to share across
    the worker threads, and mmap-backed open is cheap.
    """
    doc = fitz.open(PDFS[vol])
    try:
        pix = doc[idx].get_pixmap(dpi=RENDER_DPI, colorspace=fitz.csGRAY)
        return Image.frombytes("L", (pix.width, pix.height), pix.samples)
    finally:
        doc.close()


def page_png_b64(img):
    w, h = img.size
    scale = MAX_LONG_SIDE / max(w, h)
    if scale < 1:
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def label_of(pageid):
    """Human-readable page label from a v{vol}p{idx} id (printed no. resolved elsewhere)."""
    return pageid


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


def transcribe(page):
    """page = (vol, idx, pageid). Return (pageid, markdown) or (pageid, None, err)."""
    vol, idx, pageid = page
    try:
        b64 = page_png_b64(render_page(vol, idx))
        label = label_of(pageid)
        call = call_anthropic if BACKEND == "anthropic" else call_openai
        body = clean(call(b64, label))
        return pageid, f"<!-- page: {label} -->\n\n{body}\n"
    except Exception as e:  # isolate per-page failures so the batch continues
        return pageid, None, repr(e)


def all_pages():
    """Every transcribable page as (vol, idx, pageid), in reading order."""
    pages = []
    for vol in sorted(PDFS):
        doc = fitz.open(PDFS[vol]); n = doc.page_count; doc.close()
        pages += [(vol, i, f"v{vol}p{i:03d}") for i in range(n)]
    return pages


def main():
    global MODEL, OUT_DIR, CLIENT, BACKEND
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="transcribe only these page ids, e.g. v1p005")
    ap.add_argument("--vol", type=int, choices=list(PDFS), help="limit to one volume")
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

    pages = all_pages()
    if args.vol:
        pages = [p for p in pages if p[0] == args.vol]
    if args.only:
        wanted = set(args.only)
        pages = [p for p in pages if p[2] in wanted]
    OUT_DIR.mkdir(exist_ok=True)
    if args.skip_existing:
        pages = [p for p in pages if not (OUT_DIR / f"{p[2]}.md").exists()]
    if not pages:
        raise SystemExit("Nothing to do (no matching pages, or all already transcribed).")

    print(f"Transcribing {len(pages)} page(s) with {MODEL} -> {OUT_DIR}/ ...")
    ok, failed = 0, []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for result in pool.map(transcribe, pages):
            pageid = result[0]
            if result[1] is None:
                failed.append((pageid, result[2]))
                print(f"  {pageid}: FAILED {result[2]}")
                continue
            (OUT_DIR / f"{pageid}.md").write_text(result[1], encoding="utf-8")
            ok += 1
            print(f"  {pageid}: {len(result[1])} chars")
    print(f"\nDone. {ok} ok, {len(failed)} failed.")
    if failed:
        print("Re-run with --skip-existing to retry the failures:")
        for pageid, err in failed:
            print(f"  {pageid}: {err}")


if __name__ == "__main__":
    main()
