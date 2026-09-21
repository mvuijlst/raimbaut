# Provenance of the transcription (Stage 1 — ran once, kept as documentation)

Nothing in this folder is part of the live pipeline. It records how `corpus/*.md` came
to be; see WORKFLOW.md §2. The scripts are as they were when they last ran — they expect
to be run from the repository root next to the (private, git-ignored) PDF scans, and the
paths inside them still name the files as they were called then (`corpus-v2-sources.csv`
is `corpus-sources.csv` here).

| File | What it is |
|------|------------|
| `transcribe.py` | page image → Markdown transcription with gpt-4o (prompt included) |
| `merge_corpus.py`, `merge_corpus_v2.py` | overlay of the Claude-transcribed Occitan/verse pages on the gpt-4o base |
| `occitan_pages.txt` | the page ids that were overlaid |
| `corpus-sources.csv` | per-page provenance of the final corpus: 499 pages gpt-4o, 87 Claude |
| `review-diff.md` | the 43-page A/B comparison (997 differing hunks) that motivated the hybrid |

`ocr_page_numbers.py`, which produced `page_numbers.csv`, stays at the root: `manage.py`
can still run it.
