# Raimbaut d'Orange — édition électronique

[![verify](https://github.com/mvuijlst/raimbaut/actions/workflows/verify.yml/badge.svg)](https://github.com/mvuijlst/raimbaut/actions/workflows/verify.yml)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22873502.svg)](https://doi.org/10.5281/zenodo.22873502)

Source of **<https://raimbaut.yusupov.cloud>**, the web edition of Marc Vuijlsteke's
unpublished doctoral thesis, *Interprétation "philologique" et "poétique" du Chansonnier
de Raimbaut d'Orange* (Rijksuniversiteit Gent, 1981): a critical edition, French
translation and commentary of the thirty-nine songs of the troubadour Raimbaut d'Orange,
followed by a study of his poetics, a bibliography and indexes.

## What is here

| | |
|---|---|
| `corpus/` | the thesis, transcribed page by page from the typescript (586 pages) — the source of truth |
| `book.md`, `*.json` | the assembled text and the derived apparatus (bibliography, sigla, cross-references, catalogue of songs) |
| `build_*.py`, `assemble_book.py`, `normalize_typography.py` | the deterministic, standard-library pipeline that derives them |
| `manage.py` | one entry point for all of it: rebuild what is stale, verify, build the site, deploy |
| `site/` | the Eleventy site that renders the edition (web view, book view, paginated facsimile, search) |
| `manuscripts/`, `images/` | photographs — see *Licence* |
| `provenance/` | how the transcription was made (one-time scripts, comparison, per-page sources) |
| `WORKFLOW.md` | the whole process, from the scans to the published site |

## Build

```
python manage.py verify      # normalise + rebuild all derived data; must reproduce what is committed
cd site && npm ci && npm run build      # → site/_site
```

Python 3.10+ (standard library only) and Node 18+. `WORKFLOW.md` has the details; the
same two steps run on GitHub for every push.

## Cite

> Marc Vuijlsteke, *Interprétation "philologique" et "poétique" du Chansonnier de Raimbaut
> d'Orange*, thèse de doctorat, Rijksuniversiteit Gent, 1981. Édition électronique établie
> par Michel Vuijlsteke, 2026. https://raimbaut.yusupov.cloud/ — archived at
> https://doi.org/10.5281/zenodo.22873502

## Licence

The **text** of the edition is CC BY 4.0 (`LICENSE-TEXT.md`); the **code** is MIT
(`LICENSE`). Not covered: the manuscript photographs (Bibliothèque nationale de France —
source gallica.bnf.fr / BnF; Biblioteca Apostolica Vaticana — © BAV, all rights
reserved), the portrait and the photographs in `images/`, and the fonts (SIL OFL, texts in
`site/src/fonts/`). Those image folders are left out of release archives.
