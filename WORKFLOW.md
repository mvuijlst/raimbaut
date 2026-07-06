# Workflow — from scans to the published edition

This is the end-to-end recipe for the web edition of the 1981 Ghent thesis on the
troubadour **Raimbaut d'Orange** (site: <https://raimbaut.yusupov.cloud>). It covers
every stage from the raw PDF scans to the deployed static site, what each script
consumes and produces, and how to re-run any part of it.

For day-to-day operation you don't need to run these by hand — `python manage.py`
gives you a menu-driven TUI that knows the dependency order, detects what is stale,
rebuilds only what's needed, serves locally, and deploys. This document is the
reference behind that tool.

---

## 0. The shape of the pipeline

```
  PDF scans (private)                    ── vision, one-time ─────────────────┐
    vol1 910001066311                                                         │
    vol2 910001066313          transcribe + merge (gpt-4o)   ─►  corpus/*.md  │
    vol3 910001066314 (annex)  ocr_page_numbers.py (4o-mini) ─►  page_numbers.csv
                                                                              │
  ── derived data (pure-stdlib Python, deterministic, fast) ──────────────────┤
                                                                              ▼
    normalize_typography.py    corpus/*.md  ──(in place, idempotent)          
    build_manifest.py          corpus + page_numbers.csv        ─►  manifest.json
    assemble_book.py           corpus + manifest                ─►  book.md
    build_bibliography.py      corpus + manifest                ─►  bibliography.json
    build_catalogue.py         corpus + manifest                ─►  chansons.json
    build_citations.py         corpus + manifest + biblio + sigla-overrides ─► citations.json
    build_references.py        corpus + manifest + citations + biblio        ─► references.json
    build_footnote_norm.py     book.md + references + biblio + citations      ─► footnote-normalization.json

  ── hand-authored (never generated) ─────────────────────────────────────────
    manuscripts.json   sigla-overrides.json   manuscripts/*.jpg   images/   site/src/…

  ── site build (Eleventy 3, Node) ───────────────────────────────────────────
    site/src/_data/edition.js  reads  book.md + the 7 JSONs   ─►  site/_site/  (static HTML)

  ── deploy (PowerShell) ──────────────────────────────────────────────────────
    deploy.ps1   build ─► tar ─► scp ─► extract on yusupov:2708 ─► raimbaut.yusupov.cloud
```

Two properties make this manageable:

* **The vision stages run once.** Once `corpus/*.md` and `page_numbers.csv` exist and
  are committed, they are the editable source of truth. You do not re-transcribe to
  fix a typo — you edit the corpus page directly.
* **Everything downstream of the corpus is deterministic and stdlib-only.** The eight
  data scripts import nothing beyond the Python standard library, so they run under
  any Python 3.11+ (including the system 3.14) without a working virtualenv.

---

## 1. Source scans (Stage 0 — private provenance)

Three OCR'd PDFs live at the repo root and are **git-ignored on purpose** (locked
decision: the scans stay private provenance, never published):

| File | Volume | Role |
|------|--------|------|
| `910001066311_2024_0001_AC.pdf` | vol 1 | Introduction + chansons (pp. up to 297 pageids `v1p000…`) |
| `910001066313_2024_0001_AC.pdf` | vol 2 | Chansons cont., bibliography, index (`v2p000…`) |
| `910001066314_2024_0001_AC.pdf` | vol 3 | Annex — **excluded** from the edition |

A stable page id `v{vol}p{idx}` (zero-padded, e.g. `v1p050`) is assigned by PDF page
order. This id threads through every artifact as the anchor of provenance.

---

## 2. Vision extraction (Stage 1 — one-time, needs the PDFs + OpenAI key)

> These scripts require `OPENAI_API_KEY` in `.env` and the third-party deps
> (`pymupdf`/`fitz`, `openai`, `pillow`, `python-dotenv`) in the virtualenv (see
> **§8 Environment**). In normal operation you never need this stage.

**2a. Transcription → `corpus/*.md`.** Each rendered page image is sent to `gpt-4o`
with a prompt that asks for a faithful Markdown transcription (italics as `*…*`,
underlined runs as `[…]{.underline}`, Occitan verse in `::: {lang=oc}` fenced divs,
per-page footnotes as `[^N]`). gpt-4o is near-publication quality on the French
prose but corrupts the Occitan verse — established by a 43-page A/B diff against
Claude (`review-diff.md`, 997 differing hunks) — so the corpus is a **hybrid**:
gpt-4o base with the verse/Occitan pages transcribed by Claude in-session and
overlaid. Result: 586 pages (298 vol1, 288 vol2), of which 499 gpt-4o and 87
Claude; per-page provenance in `corpus-v2-sources.csv`. The scripts
(`transcribe.py`, `merge_corpus.py`, `merge_corpus_v2.py`) were removed after the
corpus was finalised and later restored from history (commit `db06367`) as
documentation of this one-time stage; the final run is logged in
`transcribe-v2.log`.

Vision LLM is used deliberately instead of Tesseract/EasyOCR: the scans are faint and
a vision model reads them far more accurately (locked preference).

**2b. Printed page numbers → `page_numbers.csv`.** `ocr_page_numbers.py` crops the
top-right corner of every vol1+vol2 page and asks `gpt-4o-mini` for just the printed
number (or `NONE`). Produces `pageid,printed_number` — the map used for citation
anchors and human-facing page ranges. vol3 is skipped.

```
python ocr_page_numbers.py        # writes page_numbers.csv, logs to ocr-pagenums-v2.log
```

---

## 3. Normalisation (Stage 2)

```
python normalize_typography.py
```

Rewrites `corpus/*.md` **in place**, idempotently (re-running is a no-op). Per the
locked editorial decisions:

1. **Reflow** prose paragraphs — the transcription kept the typescript's physical line
   breaks; join each blank-line-separated block into one logical line (dropping soft
   hyphens; logged to `corrections-reflow.csv`). Fenced divs (`::: … :::`, incl.
   `.verse`) and the `<!-- page: … -->` anchor pass through untouched, so verse line
   structure survives.
2. Collapse multiple spaces (prose only).
3. `" - "` → spaced em dash `" — "`, except between two capitals.
4. Space before `; : ! ?` → narrow no-break space; guillemets get inside NNBSP.
5. Stacked `+` section breaks → a single `⁂` asterism.

**Run this after any manual edit to a corpus page**, before rebuilding the data.

---

## 4. Derived data (Stage 3 — deterministic, stdlib-only)

Run from the repo root, **in this order** (later scripts read earlier outputs):

| # | Command | Reads | Writes |
|---|---------|-------|--------|
| 1 | `python build_manifest.py` | corpus, `page_numbers.csv` | `manifest.json` — reading order `[{order,pageid,vol,printed,file,kind}]` |
| 2 | `python assemble_book.py` | corpus, `manifest.json` | `book.md` (+ `footnote-issues.md`, `corrections-crosspage-hyphen.csv`) — one document; footnote labels namespaced by pageid, page-overflow notes reunited, cross-page word-splits healed |
| 3 | `python build_bibliography.py` | corpus, `manifest.json` | `bibliography.json` — the real vol2 bibliography (pp. 470–554): `{general[], raimbaut[], par_chanson[]}` |
| 4 | `python build_catalogue.py` | corpus, `manifest.json` | `chansons.json` — catalogue of chansons I–XXXIX with pageid ranges + incipits |
| 5 | `python build_citations.py` | corpus, `manifest.json`, `bibliography.json`, `sigla-overrides.json` | `citations.json` — siglum apparatus harvested from inline "(ci-après X)" defs `{abbreviations[], manuscript_sigla, usage[], unresolved[]}` |
| 6 | `python build_references.py` | corpus, `manifest.json`, `citations.json`, `bibliography.json` | `references.json` — every op./art./ibid. cité resolved to its target work `{stats, resolved[], unresolved[]}` |
| 7 | `python build_footnote_norm.py` | `book.md`, `references.json`, `bibliography.json`, `citations.json` | `footnote-normalization.json` (+ `footnote-norm-flags.md`) — per-note replacements the reading views apply (short titles, self-contained ibid., NNBSP), Livre view untouched |

**Review outputs.** The `*-flags.md` files (`footnote-norm-flags.md`,
`bibliography-flags.md`, `index-flags.md`, `index-kwic-flags.md`, `manuscrits-flags.md`)
list every uncertain / unresolved / ambiguous case for a human to check. They're
regenerated build reports (git-ignored), not committed artifacts.

**Hand-authored data** is never regenerated and must be edited by hand:
`manuscripts.json` (the Table des manuscrits), `sigla-overrides.json` (siglum
corrections feeding `build_citations.py`), the photos in `manuscripts/`, and
`images/`. Note: `tableau_de_synthese.json` is a dead v1 leftover — nothing reads it.

---

## 5. Site build (Stage 4 — Eleventy)

The static site lives in `site/` (Eleventy 3, ESM). The global data file
`site/src/_data/edition.js` reads `book.md` plus all seven JSONs (bibliography,
chansons, citations, footnote-normalization, manifest, references, manuscripts) and
segments them into the rendered sections the `.njk` templates paginate over. Rendering
logic (footnote normalisation gate, siglum hover-cards, small-caps authors,
concordance/index building) lives in `site/lib/*.js`.

```
cd site
npm install          # first time only
npm run build        # → site/_site/    (production static output)
npm run serve        # → http://localhost:8080  (live-reload dev server)
npm run clean        # rm -rf _site
```

(The `.claude/launch.json` configs `raimbaut` / `raimbaut-alt` serve on 8099 / 8137
for the preview tooling.)

---

## 6. Deploy (Stage 5)

```powershell
.\deploy.ps1
```

Pure-static deploy to `raimbaut.yusupov.cloud`:

1. `npm run build` in `site/`.
2. `tar czf _deploy.tgz -C _site .` — ships a tarball (piping tar through the
   PowerShell pipeline corrupts binary fonts/images).
3. `scp -P 2708 _deploy.tgz yusupov:/tmp/` (ssh alias `yusupov` → `46.62.148.249`).
4. On the server: clear `/home/django/raimbaut-yusupov`, extract, `chown django:django`.

Requires the `yusupov` ssh alias (already in `~/.ssh/config`, port 2708, key
`~/.ssh/yusupov`).

---

## 7. Quick reference — "I changed X, what do I re-run?"

| You changed… | Re-run |
|--------------|--------|
| A corpus page (`corpus/vNpNNN.md`) | `normalize_typography.py` → all of Stage 3 → site build → deploy |
| `sigla-overrides.json` | `build_citations.py` → `build_references.py` → `build_footnote_norm.py` → site build |
| `manuscripts.json` or a photo | site build → deploy (no Python step) |
| A template / CSS / `site/lib/*.js` | site build → deploy |
| Nothing (just publishing) | `deploy.ps1` |

`python manage.py` computes all of this for you from file mtimes — pick **Rebuild
stale** and it runs exactly the scripts whose inputs changed, in order.

---

## 8. Environment

* **Node** ≥ 18 (tested v22). `cd site && npm install`.
* **Python** 3.11+ for the eight data scripts — **stdlib only**, no virtualenv needed;
  the system Python 3.14 runs them. `manage.py` uses whatever interpreter launched it.
* **Vision scripts only** (`ocr_page_numbers.py`, `transcribe.py`) need a
  virtualenv with `pymupdf openai pillow python-dotenv` **and** `OPENAI_API_KEY` in
  `.env`. (The venv broke once, when the Python that created it was removed; it has
  been rebuilt and works. If it ever breaks again:
  `python -m venv venv; .\venv\Scripts\Activate.ps1; pip install pymupdf openai pillow python-dotenv`.)
* **`.env`** holds `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` (git-ignored).

---

## 9. File map

```
raimbaut/
├─ 9100010663{11,13,14}_2024_0001_AC.pdf   source scans (git-ignored)
├─ corpus/            v{1,2}p*.md           transcribed + normalised pages (source of truth)
├─ page_numbers.csv                         pageid → printed number  (vision)
├─ manifest.json                            reading order            (build_manifest)
├─ book.md                                  assembled edition        (assemble_book)
├─ bibliography.json chansons.json citations.json references.json footnote-normalization.json
│                                            derived apparatus       (Stage 3)
├─ manuscripts.json  sigla-overrides.json   hand-authored data
├─ manuscripts/  images/                    photographs
├─ normalize_typography.py  build_*.py  assemble_book.py  ocr_page_numbers.py
├─ manage.py                                the management TUI  (this workflow, automated)
├─ deploy.ps1                               build + ship to production
└─ site/             Eleventy source (src/, lib/, config) → _site/ output
```
