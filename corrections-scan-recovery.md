# Scan-recovery corrections log

Hand corrections applied to `corpus/` by re-reading the original page scans
(`pages/out/*.tif` → PNG), to fix footnote markers/definitions that the bulk
gpt-4o transcription dropped or mis-numbered, plus four flagged non-footnote
issues. Every change was verified against the scan. Companion to
`corrections-footnotes.csv` (the 14 mechanical marker-syntax fixes:
`[^N^]`→`[^N]`, `[N]`→`[^N]`).

Result: `book.md` now has **0 dangling refs / 0 orphan defs** (was 30 dropped
markers + 4 dropped definitions + 1 true overflow).

## Dropped reference markers restored (definition survived, superscript re-placed)

| page | change |
|---|---|
| 002 | `[^1]` after "manifeste chez Raimbaut" |
| 008 | `[^2]` after *«salut d'amour»*; the marker at *«dreyt nien»* renumbered `[^2]`→`[^3]` |
| 022 | `[^1]` on the table (whole-table note) |
| 031 | `[^6]` after "(Raimbaut de Vaqueiras)" |
| 044 | inserted `[^5]` after "*Florilegio* en 1945"; renumbered "(XXV…)" `[^5]`→`[^6]` and "M^a^)" `[^6]`→`[^7]` |
| 055 | `[^1]` after "(*canso, sirventes…*)" |
| 056 | `a^1^` → `a[^1]` (base-manuscript siglum + dropped marker) |
| 063 | `[^6]` after "l'antécédent de *qe*" |
| 071 | `[^2]` after "un aspect duratif" |
| 083 | `…ula^2^`/`…ula^3^` → `…ula[^2]`/`…ula[^3]` (markers misread as phonetic superscripts) |
| 095 | inserted `[^1]` after *«aizida jouissance»*; renumbered "datif sans préposition" `[^1]`→`[^2]` |
| 109 | inserted `[^1]` after "*vqlh…*"; renumbered "éditeur du texte" `[^1]`→`[^2]`, "autres manuscrits" `[^2]`→`[^3]` |
| 119 | `[^1]` after "l'emploi du terme *gauq*" |
| 120 | `[^1]` after Kolsen's German quote "…brenne'" |
| 131 | `[^2]` after Cropp's translation "…auprès d'elle'" |
| 157 | `[^1]` after "de mon usage le fait" |
| 165 | `[^1]` after Kolsen's German translation "…?'" |
| 174 | stray inline "3" → `[^3]` after "…etc."; restored siglum + marker "et 4" → "et a`[^4]`" |
| 176 | inserted `[^1]` after "étroitement liés"; renumbered "au vers 62 ?" `[^1]`→`[^2]` |
| 218 | `[^1]` after "…dass ich…"; `[^2]` after "…au premier chef - [o?]" |
| 277 | `[^1]` after "cela va de soi" |
| 281 | `[^2]` after "*loing* (vv.27-28)" |
| 290 | `[^1]` after "[*m*] ou [*n*]" |
| 307 | `[^1]` after "j'en ai peur!'" |
| 318 | inserted `[^1]` after "…ne voulez souffrir…'"; renumbered "J.Audiau et R.Lavaud" `[^1]`→`[^2]` |
| 039 | bare superscript `)^1^` → `)[^1]` (done in the marker-normalization step) |

## Dropped footnote definitions recovered from the scan

| page | added |
|---|---|
| 033 | `[^2]: Ch.X,32 (éd.Toja).` and `[^3]: RO, pp.61-62.` |
| 140 | `[^4]: *Ibid.*` |
| 064 | no text missing — an off-by-one: removed a spurious `[^1]` at the Paterson quote and shifted body markers `[^2][^3][^4]`→`[^1][^2][^3]` to match the three real notes |

## Other transcription corrections

| page | change | confidence |
|---|---|---|
| 046 | replaced hallucinated year-run (1327 lines of OCR garbage) with the authoritative concordance table + recovered footnote `[^1]`. **Now rebuilt from `tableau_de_synthese.json`** (user-transcribed, 59 editions × pieces 1–39); `corpus/page-046.md` is generated, so re-run `/tmp/build_page046.py` if the JSON changes | high (authoritative) |
| 167 | chanson header "CHANSON **VII** : TEXTE ET TRADUCTION" → "**VIII**" (V + three strokes on the scan) | high |
| 150 | `[s'élève]{.unclear}` → `s'élève` (confirmed: hand-added marginal verb, caret insertion in the printed line) | high |
| 301 | `pp. [57-58]{.unclear}` → `pp. 57-58` (hand-filled numerals) | "57" high, "58" moderate |
| 316 | dropped Spanish Riquer quote continuation ("…contrario de una iglesia o una nave, donde nos las hay)") restored at the head of the page (user fix, transcript layer) and `[^1]` re-anchored onto it; my earlier provisional `[^1]` on "cette dernière interprétation" removed | high |
| 170 | `[^4]` reference (Appel's translations of *clara*) added — the original had no marker for this note; anchored at the end of the critics'-comparison paragraph (user-endorsed) | endorsed |

## Still flagged for a human pass against a high-res scan

- **301** — second page-number numeral ("58") could conceivably read 56/50.
- **PDL** (sigla) — used 3×, probably = PDP (Levy, *Petit dictionnaire*); not folded automatically (see `sigla-overrides.json`).

## Layer note (important for the pipeline)

All corrections above were applied in **`corpus/`**, which is what `assemble_book.py` consumes. `merge_corpus.py` regenerates `corpus/` from `transcripts/` (+ `transcripts-claude/` overlay); **re-running it would revert every fix here.** Do not re-run merge unless the corrections are first back-ported to the transcript layers. Treat `corpus/` as the authoritative editing layer from now on. (The page-170 and page-316 fixes were made in `transcripts/` and have been propagated into `corpus/`.)
