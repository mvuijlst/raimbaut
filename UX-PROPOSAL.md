# Une édition à trois lectures
## UX & information-architecture proposal for the digital Raimbaut d'Orange edition

*Draft 1 — 2026-07-04. Grounded in the actual corpus-v2 data: 39 chansons, 1 257 footnotes, 24 sigla, 472 resolved back-references, 292-entry bibliography, 3 indexes, page-number map.*

---

## 0. The one-sentence thesis

The print edition was forced to serialize what is really a **graph** — remarques *before* texte, notes at page feet, indexes at the back — because paper has only one dimension. The digital edition should invert this: **the poem becomes the hub**, and every other layer (translation, remarques, notes, references, bibliography, indexes) becomes an **anchored, addressable satellite** that the reader summons without ever losing the poem. Concretely: a chanson page with the Occitan text at its centre, the strophe-aligned translation beside it, and the *full, continuous* remarques in a scroll-synchronized parallel panel — plus two alternative reading modes (clean text; faithful print order) for other audiences and other tasks.

I call the model **anchored parallel commentary with layered reading modes**. It is neither Tufte margin notes (too small for essay-length remarques) nor Genius popovers (which would shred a continuous scholarly argument into fragments). It is closest to the pane model of the Van Gogh Letters edition and Dartmouth's Dante Lab, but with bidirectional scroll-sync driven by the verse anchors the thesis itself provides.

---

## 1. What the corpus actually is (and why it dictates the design)

Every IA decision below follows from five structural facts of the material:

**1.1 The remarques are a continuous essay, not a list of notes.**
Look at Chanson I: the discussion of *fenhz* runs for pages before the first lemma `v.4` appears; prose flows *between* lemmas and refers back to earlier ones ("Compte tenu de tous les éléments qui précèdent…"). A design that atomizes remarques into per-verse popovers destroys the argument. **Consequence:** the commentary must always be readable as one continuous text; verse anchors are *entry points into* it, not *boundaries around* fragments.

**1.2 The lemma keys are machine-actionable anchors.**
Entries are headed `v.4`, `v.6`, `vv.43-45`, `v.19 sv.`, `vv.3 sv.` — a small grammar (`vv?\.(\d+)(?:[-–](\d+))?(sv\.?)?`) that maps every remarque to a verse or verse-range. **Consequence:** we can mark annotated verses in the poem, jump both ways, and scroll-sync the two columns. This is the load-bearing data structure of the whole design.

**1.3 The translation is strophe-aligned prose, not line-by-line.**
One French paragraph per Occitan strophe. **Consequence:** interlinear display is impossible and facing *lines* are meaningless; the natural unit of text/translation pairing is the **strophe**. This makes layout much easier than a line-aligned edition would be.

**1.4 The notes are themselves deep.**
Footnotes inside remarques run to 200+ words, contain sigla (RO, SW, LR, TOB…), resolved back-references (op. cit., ibid. — 472 of them, confidence-graded), cross-references (supra/infra, "voir chanson X"), and bibliography citations. **Consequence:** there are *four distinct link species* that need four distinct but coherent affordances, and notes need room — they cannot live in a margin.

**1.5 Everything is already addressable.**
`chansons.json` (39 ranges), `citations.json` (sigla→definitions→bibliography), `references.json` (back-refs→antecedents), `bibliography.json` (292 + per-chanson blocks), `page_numbers_v2.csv` (pageid→printed page). **Consequence:** deep-linking, hover previews, backlinks and a printed-page resolver are cheap. The pipeline work is done; this is a rendering and interaction problem, not a data problem.

### The five reader tasks to design for

| # | Task | Reader | Primary surface |
|---|------|--------|-----------------|
| T1 | Read a poem, with or without French | student, non-specialist | **Lecture** mode |
| T2 | Study one verse: "what does the editor say about v.6?" | scholar | verse markers → **Étude** panel |
| T3 | Read the commentary as an argument, start to finish | peer, medievalist | **Étude** panel scrolled linearly, or **Livre** mode |
| T4 | Chase a citation: what is SW? what else cites Marshall? | scholar | hovercards → bibliography with backlinks |
| T5 | Survey & compare: word occurrences, editions history, cross-chanson themes | researcher | indexes, search, concordance |
| T6 | **Cite the edition** — digitally *and* against the printed thesis | everyone scholarly | citation tool + page resolver |

Design pages around tasks, not around the print's chapter divisions.

---

## 2. Design principles

1. **The poem is sovereign.** Occitan text is always the visual primary; apparatus never interleaves with it, never reflows it, never recolours it. Apparatus lives beside, below, or in overlays.
2. **Hover previews, click commits.** Hovering any apparatus link shows a card (free, no state change). Clicking navigates (changes state, honours the back button). Readers learn one rule and can then explore fearlessly.
3. **Continuity of the commentary is inviolable** (fact 1.1). Anchors position you *within* the essay; they never excerpt it.
4. **Depth budget: two layers visible at once.** Poem + one apparatus layer (commentary panel, hovercard, sheet). A third layer (a note *inside* the commentary) opens by displacing, not stacking.
5. **Everything has a URL.** Every chanson, strophe, verse, lemma, note, siglum, bibliography entry, index entry, and *printed page* is addressable. Nothing ever has to be re-found.
6. **Honest uncertainty.** The pipeline's confidence grades (back-ref resolution high/medium/low, `{.unclear}` readings) are *displayed*, not hidden: dashed underlines, "résolution probable" labels. This is an editorial value the project already committed to.
7. **Semantic HTML first, JS as enhancement.** With JavaScript off, every chanson page is a complete, correctly ordered document (text → translation → remarques with anchor links). Sync, panels and sheets are progressive enhancement. This is also the accessibility and longevity story.
8. **Fidelity has its own mode.** The reordering (texte before remarques) is an editorial intervention; **Livre** mode preserves the original print order and printed page numbers, so nothing scholarly is lost by the redesign.

---

## 3. The three reading modes

One chanson page, three presentations of the same underlying HTML. Mode is a client-side toggle, remembered in `localStorage`; deep links carry mode only when it matters (`?mode=livre`).

### Lecture — the poem, beautifully
Occitan strophes + strophe-paired translation. No verse markers, no superscripts, no panel. Generous type, hemistich gaps preserved, verse numbers every 5 lines as in print. For T1 and for anyone's first contact with a chanson. This is the mode that makes non-specialists stay.

### Étude — the poem with its apparatus (default on wide screens)
The core innovation. Poem + translation in the main column; the **full remarques** in a parallel panel; annotated verses carry gutter markers; the two columns scroll-sync bidirectionally (§5). Footnotes, sigla, back-refs live inside the panel with their respective affordances (§6). For T2 and T3.

### Livre — the print, faithfully
The chanson exactly as the thesis prints it: REMARQUES first (continuous, footnotes as Tufte-style sidenotes where width allows, endnote-style otherwise), then TEXTE ET TRADUCTION; printed page numbers rendered in the margin (`p. 46`); the existing page anchors become visible landmarks. For verification against the printed thesis, for citation checking, and as the no-JS/print baseline. The introduction and *Vers une poétique* chapters are essentially always in this mode — they are linear prose and the current Tufte treatment already suits them.

**Why modes rather than one clever layout:** the audiences genuinely conflict. The layout that serves T3 (dense, two panes, markers everywhere) actively harms T1 (a student meeting *Ar resplan la flors enversa* for the first time). Modes cost one toggle; a single compromise layout costs every audience something.

---

## 4. Site structure, navigation, URL scheme

### 4.1 Sitemap

```
/                          Front door: the edition in one screen — title, 1-para
                           orientation, entry tiles (Chansons · Introduction ·
                           Poétique · Bibliographie · Index · Recherche),
                           "how to cite", colophon/provenance note
/introduction/1..n/        Chapterized (Tufte linear layout, as built)
/chansons/                 The corpus index (see 4.2)
/chansons/ii/              Chanson page — THE core template (§5)
/chansons/ii/livre/        Print-order view (also reachable via mode toggle)
/poetique/1..7/            Concluding essay, chapterized (as built)
/bibliographie/            Filterable list; per-entry anchors + backlinks
/sigles/                   Abbreviations table (24), cross-linked to biblio
/index/mots/               INDEX DES MOTS      → verse/page links
/index/noms/               INDEX DES NOMS      → page links
/index/oeuvres/            INDEX DES ŒUVRES    → page links
/concordance/              Interactive table de synthèse (59 editions × 39 pièces)
/recherche/                Search (Pagefind), faceted (§8.1)
/pages/47                  Printed-page resolver → redirects to the location
                           of thesis p. 47, scrolled and highlighted
```

### 4.2 The chansons index — an overview that *is* an instrument

Not a bare list. A table, one row per chanson: **№ (roman) · incipit (oc, italic) · P.-C. number · genre/form tag if available · counts** (verses, remarques) · quick links (Texte / Remarques). Sortable; filter box. A second view toggle shows the same corpus as the **concordance matrix** (which earlier editors printed which pieces, 1774–1948) — the thesis's own tableau de synthèse, made interactive: hover a cell → edition + piece; click row-head → bibliography entry; click column-head → chanson. This is the "you can only do this digitally" artifact of Part 2's front door.

### 4.3 Persistent wayfinding (the anti-lostness kit)

- **Masthead (sticky, compact, one line):** edition title (→ home) · breadcrumb (`Chansons › II. En aital rimeta prima`) · **chanson switcher** (dropdown: I–XXXIX with incipits, ←/→ prev-next) · mode toggle (Lecture/Étude/Livre) · search icon (⌘K).
- **Left rail (desktop):** the *sommaire* of the current chanson — Tradition & éditions / strophes 1…n (with annotation-density dots) / list of lemmas (v.4, v.6, v.10…). Doubles as a minimap: the in-view strophe is highlighted.
- **Fragment identifiers:** `#s3` (strophe), `#v24` (verse), `#rem-v24` (lemma), `#n-v1p043-2` (note), `#p-46` (printed page anchor). Arriving on any fragment scrolls, highlights briefly (2 s fade), and — in Étude — positions *both* columns.
- **Citation tool (T6):** select any passage or click a ¶ affordance → "Citer" popover with (a) the deep URL, (b) a formatted reference including the **printed page equivalent** from the page map ("…, p. 46 de l'édition de 1981"), (c) copy buttons. Scholars can cite the site *and* remain compatible with everyone who cites the print thesis. The `/pages/N` resolver is the inverse operation.

---

## 5. The chanson page

### 5.1 Anatomy (shared across breakpoints)

1. **Chanson header:** roman numeral + incipit; P.-C. number; a collapsed **"Tradition manuscrite & éditions"** card (manuscripts sigla, prior editions — from the per-chanson bibliography blocks) — one click to open, closed by default (overload rule).
2. **Texte:** strophes as blocks. Line numbers every 5 (print-faithful) rendered statically; *every* line number appears on hover/focus. Hemistich double-gaps preserved (`white-space: pre-wrap`, as built). Interpuncts render as text.
3. **Traduction:** one prose paragraph per strophe, visually paired with it (layout varies by breakpoint, below).
4. **Verse markers:** a small dot in the gutter of each line (or range brace for `vv.43-45`) that has a remarque; the marker carries a count when multiple lemmas target the line. Markers exist only in Étude mode.
5. **Remarques:** the continuous commentary (placement varies by breakpoint). Lemma headings render as `v. 6` pills; **each lemma heading embeds the anchored verse(s) as a small quoted line beneath it** — the digital fix for print's flip-back problem: the commentary always shows what it is commenting on.
6. **Footer:** prev/next chanson pager; link to this chanson's row in the concordance; link to Livre view.

### 5.2 Desktop (≥ 1200 px) — the parallel-commentary layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ RAIMBAUT D'ORANGE   Chansons › I. Cars, douz e fenhz…   [Lecture|Étude|Livre] ⌘K │
├──────────┬──────────────────────────────────────┬──────────────────────────┤
│ SOMMAIRE │  CHANSON I                           │ REMARQUES        ⟲ sync  │
│          │  Cars, douz e fenhz del bederesc     │ ────────────────────────│
│ Tradition│  P.-C. 389,22                        │ (headnote: discussion    │
│ Strophe 1│                                      │  of *fenhz*, pp. 33–45…) │
│ Strophe 2│  ┌─ Strophe 1 ──────┬─ Traduction ─┐ │                          │
│ Strophe 3│  │ Cars, douz e     │ Le bas chant │ │ ◈ v. 4                   │
│ Strophe 4│  │  fenhz…          │ du roitelet  │ │ │ "el temps qe grill    │
│  …       │  │ ● 4 el temps qe… │ vers lequel  │ │ │  prob del siure"      │
│ ──────── │  │ 5 chanton el mur │ je m'élève,  │ │ Aux exemples de *siure* │
│ Remarques│  │ ● 6 qe·s compassa│ m'est         │ │ cités par Pattison¹,    │
│  v.4     │  │   …              │ précieux…    │ │ nous pourrions ajouter  │
│  v.6     │  └──────────────────┴──────────────┘ │ ceux donnés par Pansier:│
│  v.10    │                                      │ "*sieure* (1374)…"²     │
│  v.13    │  ┌─ Strophe 2 ──────┬─ Traduction ─┐ │                          │
│  v.19sv  │  │ 10 Cars jois e   │ Je nourris et│ │ ◈ v. 6                   │
│  v.30    │  │  genhz…          │ j'élève de   │ │ │ "qe·s compassa e      │
│          │  │  …               │ précieuses…  │ │ │  s'esqaira"           │
│          │  └──────────────────┴──────────────┘ │ Pattison relie ce vers à │
│          │                                      │ ce qui suit… [RO]…       │
└──────────┴──────────────────────────────────────┴──────────────────────────┘
   ~200 px            fluid, poem ≤ 40ch/col           380–440 px, sticky,
                                                       internally scrollable
```

- **Strophe pairing:** Occitan lines left, French paragraph right, top-aligned per strophe (CSS grid row per strophe). Occitan verse lines are short (~30 ch), so both fit comfortably. In Lecture mode this same pairing simply loses the markers and the right panel, and the poem centre-aligns in the freed width.
- **The panel is the whole remarques text**, never an excerpt. Lemma headings are sticky *within* the panel while their entry scrolls, so you always know which lemma you are inside.
- **Bidirectional scroll-sync:** scrolling the poem drives the panel to the lemma for the topmost in-view annotated verse (smoothly, throttled). Scrolling the panel manually **breaks sync** — a small `⟲ resynchroniser` chip appears; clicking a lemma heading in the panel highlights (pulse) the target verses in the poem and re-anchors sync there. Clicking a verse marker jump-scrolls the panel and pulses the lemma. Sync state is visible, never magical: readers must always be able to *decouple* the panes to read the commentary linearly (T3) and re-couple at will (T2). This is the same mental model as a code editor's minimap or a synced diff view — familiar to no medievalist and yet learned in ten seconds, because the coupling is visible.
- **Left rail** lemma list = the panel's table of contents; click → both panes position.

### 5.3 Tablet (768–1199 px)

Two zones, no left rail (sommaire collapses into the masthead breadcrumb as a dropdown):

- **≥ 1024 px landscape:** keep poem + panel (translation moves *below* each strophe instead of beside it — the pairing unit stays the strophe).
- **768–1023 px:** poem full-width (translation below each strophe, collapsed behind a per-strophe `Traduction ⌄` disclosure, default open — remembered globally). Remarques become a **right drawer** (~85 % width, overlay with scrim) opened by verse markers or a persistent edge tab `Remarques`. The drawer contains the same continuous commentary with the same lemma navigation; closing it returns you exactly where you were in the poem.

### 5.4 Mobile (< 768 px)

Single column; the poem is the page.

- **Strophe unit:** Occitan strophe, then a quiet `Traduction ⌄` disclosure (state remembered: a reader who wants French gets French everywhere after one tap).
- **Verse markers** sit in the left gutter. Tap → **bottom sheet** at half height showing the commentary *positioned at that lemma* (again: the full text, positioned — not an excerpt). Sheet affordances: drag to full-screen, `‹ v.4 · v.6 ›` prev/next lemma stepper in the sheet header, swipe-down to dismiss. Footnotes inside the sheet are tap-to-expand disclosures.
- **`Lire les remarques`** button after the poem → the linear commentary view (with embedded verse quotations under each lemma heading, so no flipping back).
- Lecture mode is the **default on mobile**; Étude only changes what markers/sheets do, so the toggle collapses to a single "Afficher l'apparat" switch.

### 5.5 What happens in Livre mode

Same content, print order: header → REMARQUES (footnotes as margin sidenotes ≥ 1280 px, else as tappable inline notes) → TEXTE ET TRADUCTION. Printed page numbers appear as marginal milestones (`— p. 34 —`), and `#p-N` anchors work. This is byte-for-byte the no-JS fallback rendering, which is exactly the point.

---

## 6. The apparatus: four link species, one system

Every interactive token in the commentary follows *hover = preview card, click = go* (principle 2). The four species are distinguished by typography, not by four colours (colour marks *interactivity*, one accent — a manuscript-rubric red — marks them all):

| Species | In-text form | Hover card shows | Click goes to |
|---|---|---|---|
| **Footnote call** | superscript number `²` | first ~40 words of the note | expands the note **in place**, below the current paragraph inside the panel (disclosure, not popover — notes are long, fact 1.4). Only one note open per lemma by default. |
| **Siglum** | small-caps, dotted underline: `SW` | full expansion: "Levy, *Provenzalisches Supplement-Wörterbuch*…" + "voir la notice" | `/sigles/#SW`, which itself links into `/bibliographie/` |
| **Back-reference** | `art. cité`, `ibid.` with dotted underline; **dashed** underline when confidence < high, tooltip prefixed "résolution probable :" | the resolved antecedent (author, title, page) from `references.json` | the antecedent note (`#n-…`) or bibliography entry |
| **Cross-reference** | `supra`, `infra`, `voir chanson X`, `v. 24` | target preview (the verse text, the section heading) | the target fragment, both panes positioned |

Additional rules:

- **Verse references inside prose become live** (`v.5`, `vv.366-7` when they refer to the current chanson): hover shows the verse, click pulses it in the poem column. This single feature turns the commentary's internal argumentation into navigation.
- **`{.unclear}` readings** render with a subtle wavy underline and a tooltip ("lecture incertaine dans l'original") — honesty rule.
- **Occitan inside prose** keeps its italics and `lang="oc"` (screen readers, search facets, and the reader's eye all rely on it).
- In **Lecture** mode none of these affordances exist. In **Livre** mode they all exist but notes render as sidenotes/endnotes rather than disclosures.

---

## 7. Moving between levels (the graph, made walkable)

The four nested levels — collection → chanson → verse/passage → remarque/note — plus the transversal surfaces (bibliography, sigla, indexes, concordance, search) form a graph. Rules for walking it without getting lost:

- **Down** (collection→chanson→verse→note): index table → chanson page → verse marker → panel lemma → note disclosure. Each step is one click; each step updates the URL fragment; the browser back button walks you back *up* the same path.
- **Across** (verse→bibliography, note→note, chanson→chanson): hovercards preview before you commit; committed jumps to transversal pages (bibliography, sigles) open **in place** with the back button as the return path — no new tabs by default, no modal mazes.
- **Up / return:** the breadcrumb is always one click from any depth; the pulse-highlight on arrival marks *where you landed*, and a small "↩ retour au texte" chip appears in the panel after any in-panel jump, returning to the last poem position.
- **Backlinks close the loop:** every bibliography entry lists "Cité dans : Chanson II, rem. v.6, n.2 · Chanson VII, n.4 · …" (computed by inverting `references.json` + the footnote-citation harvest). Every sigles entry lists usage counts and first definition location. The indexes (§8.2) do the same for words and names. The reader can start *anywhere* — a bibliography entry, a word, a printed page number — and get to the relevant verses.

---

## 8. Search, indexes, concordance

### 8.1 Search — Pagefind, faceted

Static search (Pagefind) fits the Eleventy build, costs no server, and lazy-loads index chunks. Index at the **section level with sub-results** (Pagefind's anchor support maps hits to strophes/lemmas). Facets, from data we already have:

- **Partie:** Introduction / Chansons / Poétique / Bibliographie / Notes
- **Chanson:** I–XXXIX
- **Couche:** texte occitan / traduction / remarques / notes (derivable from the structural markup)
- **Langue:** occitan vs français — the `lang` spans make this facet possible; index Occitan content with a **diacritic- and interpunct-folding normalizer** (`qe·s` findable as `qes`, `roïll` as `roill`) — Occitan orthography is unstable and users will type ASCII.

Search UI: ⌘K dialog everywhere; results grouped by partie; hit → deep link with highlight.

### 8.2 The three print indexes → linked instruments

Phase 1 (cheap): render each index as a two-column linked list; page references become links via the printed-page map (`p. 555` → `/pages/555` resolver targets). Phase 2 (high value, Index des mots first): resolve word-index entries to **verse occurrences** (`entrebescar — I, 19; II, …`) so the index links directly to pulsed verses; this makes the word index a concordance of Raimbaut's lexicon, which for a *trobar clus* poet is precisely what researchers want.

### 8.3 Bibliography

One page, three filter chips (Ouvrages généraux / Sur Raimbaut / Par chanson) + author search. Entries: formatted citation, siglum badge when one exists, **backlinks list** (§7), anchor for citing. The per-chanson blocks also surface on each chanson page inside the "Tradition & éditions" card — same data, two doors.

### 8.4 Concordance (tableau de synthèse)

The 59-editions × 39-pieces matrix as an interactive grid: sticky header row/column, cell hover → tooltip (edition, year, piece incipit), row heads → bibliography entries, column heads → chansons, a year-range brush if it proves useful. Modest engineering, unique payoff; no print edition can do this.

---

## 9. Preventing overload while preserving depth

The explicit ruleset (several already stated, gathered here as the designer's checklist):

1. **One primary, one satellite.** At any moment: the poem plus at most one apparatus surface (panel *or* sheet *or* hovercard). Notes open inside the panel by displacement, not stacking.
2. **Default-closed for metadata, default-open for text.** Tradition card, note disclosures: closed. Poem, translation, commentary text: open. Nothing textual is ever hidden behind interaction in the reading modes where it belongs.
3. **Hover is free.** No hover ever changes state. Exploration costs nothing; commitment is always a click and always reversible via back.
4. **Modes gate density.** Lecture shows zero apparatus affordances. The student never sees the scholar's cockpit unless they flip the switch — and the switch teaches them the edition has depth.
5. **One accent colour** for all interactivity; species distinguished typographically (§6). Four colours would be a legend to memorize; one colour + shape is a rule to internalize.
6. **Position is meaning.** Commentary always right (or sheet-below on mobile); notes always expand downward in place; bibliographic detail always hovercard-then-page. Nothing ever appears in two different places on different days.
7. **Visible sync state.** The panel says whether it is following the poem or free-scrolling; the reader, not the software, owns the coupling.
8. **Motion budget:** scroll-sync smooth but throttled; arrival pulses 2 s and stops; `prefers-reduced-motion` disables both (instant positioning, static highlight).
9. **Persistence:** mode, translation-disclosure state, and panel width (if we allow dragging) are remembered per device. The edition adapts to the reader once, then stays put.

---

## 10. Pattern trade-offs (why this hybrid)

| Pattern | Strengths | Fatal weakness here | Verdict |
|---|---|---|---|
| **Tufte margin notes** (current scaffold) | elegant, zero-JS, perfect for the Introduction/Poétique prose | margins cannot hold essay-length remarques with their own footnotes; no verse anchoring | **Keep for linear prose parts + Livre mode footnotes**; insufficient for Part 2 |
| **Genius-style popover annotations** | superb anchor affordance, mobile-friendly | atomizes a *continuous* argument (fact 1.1); nested footnotes inside popovers are unusable; no linear commentary reading (T3) | Take only the **marker affordance** |
| **Facing panes, scroll-synced** (Van Gogh Letters, Dante Lab) | preserves continuity of both texts; both always visible; scholarly precedent | needs width; sync must be visible & breakable or it fights the reader; costs JS | **Core of Étude mode**, with visible/breakable sync |
| **Collapsible/accordion commentary inline** | single column, mobile-trivial | hides structure (can't scan what's annotated), breaks find-in-page and printing, interleaves apparatus with the poem (violates principle 1) | Rejected except as **mobile translation disclosure** (one small, uniform use) |
| **Tabbed layers** (Texte / Traduction / Remarques as tabs) | maximal simplicity | destroys simultaneity — the whole point of a facing edition is seeing text *and* translation *and* commentary together; orientation resets on every tab switch | Rejected |
| **App-like SPA reader** (Scaife-style) | powerful, stateful | heavyweight, fragile longevity, poor URLs unless heroically engineered, overkill for a single-work edition; conflicts with static-site value | Rejected; static + progressive enhancement wins |
| **Print-faithful linear page** | maximal fidelity, zero risk | the print order itself is the problem being solved (remarques 13 pages before the texte they discuss) | **Preserved as Livre mode**, demoted from *the* design to *a* mode |

The recommended hybrid takes: markers from Genius, panes+sync from the letters-edition tradition, sidenotes from Tufte (where they still fit), modes from reader apps, and static-first delivery from the minimal-editions school (Ed./Eleventy). Precedents worth a designer's afternoon: **vangoghletters.org** (pane discipline, note anchoring), **Dante Lab / Digital Dante** (text+translation+commentary simultaneity), **Folger Shakespeare** (clean line-anchored notes, restraint), **Beckett Digital Manuscript Project** (apparatus depth), **Rialto/BEdT/Corpus des troubadours** (domain neighbours — mostly plain HTML; this edition can leapfrog the entire subfield).

**Cost acknowledged:** the Étude pane is the one genuinely engineered component (anchor parsing, sync, resize). Mitigations: it is *one* component; it degrades to the Livre layout without JS; everything else on the site is static templating we already have.

---

## 11. Typography & visual language (brief for the designer)

- **Type:** one serif family with true italics, small caps, and old-style figures (self-hosted; candidates: Source Serif 4, ET Book, Vollkorn — must cover Occitan diacritics ï, ç, é and the interpunct ·). Occitan poem in roman; Occitan *inline in prose* keeps thesis italics. UI microtext in a humanist sans, sparingly.
- **Scale:** poem 1.125–1.25 rem with leading ≥ 1.6; panel text one step down; notes one step further. Measure ≤ 40 ch for verse, ≤ 70 ch for prose.
- **Colour:** ink on paper-white (and a true dark mode later); **one accent** — manuscript-rubric red — for all interactive apparatus; annotation markers a muted warm dot; pulses a translucent accent wash.
- **Verse numbers:** hairline grey, tabular figures, right-aligned in a fixed gutter; every-5 static, all-on-hover.
- **Hemistich gaps and interpuncts are content** — never collapse, never restyle.
- **Print stylesheet:** Livre mode is the print layout; panels/markers vanish; notes become real footnotes via CSS counters; URL of the page and citation line in the footer.

---

## 12. Accessibility & performance (non-negotiables)

- Semantic order without JS = Livre order; panel/sheet are `aria-expanded` disclosures and a complementary landmark; markers are real buttons with labels ("Remarque sur le vers 6"); sync announcements via a polite live region, throttled.
- `lang="oc"` / `lang="fr"` throughout (screen readers won't have Occitan voices, but correct tagging prevents French TTS mangling and serves search).
- Full keyboard grammar: `j/k` strophe, `n/p` lemma, `t` translation toggle, `m` mode, `/` search, `Esc` closes sheet/drawer/card. Focus is *moved* on every jump, not just scrolled.
- Contrast AA minimum including the hairline verse numbers (test them — hairline grey fails easily); hit targets ≥ 44 px on touch (markers get an invisible padding halo).
- Performance: static HTML, zero framework, one ~10–15 KB vanilla JS bundle (sync + disclosures + hovercards + sheet), fonts subsetted & preloaded, Pagefind lazy chunks. Target: chanson page interactive < 1 s on mid-range mobile. No network dependencies (already a project rule).

---

## 13. Build plan (on top of the existing pipeline)

The corpus work is done; this is presentation-layer work. Phases, each shippable:

**P0 — Data shaping (new script: `build_remarques_v2.py`)**
Parse each chanson's remarques pages into ordered entries: optional headnote (prose before the first lemma) + lemma entries `{anchor: {from, to, open_ended}, html, notes[]}` with the grammar `^vv?\.\s?(\d+)(?:\s?[-–]\s?(\d+))?(?:\s*sv\.?)?$` (tolerate `^sv^` superscript artefacts). Prose between lemmas attaches to the preceding entry. Likewise shape texte into `{strophes: [{n, lines: [{n, text}]}], translation: [para…]}` (strophe i ↔ paragraph i; verify counts per chanson, flag mismatches for hand-review). Everything else (sigla, back-refs, bibliography, page map) already exists.

**P1 — Semantic chanson page (no JS).** New Eleventy template: header, strophe-paired texte+traduction, linear remarques below with lemma anchors and embedded verse quotations, footnotes as sidenotes. This *is* Livre-adjacent and already better than the current single-flow section pages. Introduction/Poétique keep the current Tufte templates.

**P2 — Étude enhancements.** Verse markers; sticky panel; bidirectional sync with visible break/re-sync; left-rail sommaire; fragment grammar + arrival pulses.

**P3 — Apparatus affordances.** Hovercards (siglum, back-ref, cross-ref, note preview) from `citations.json`/`references.json` inlined as JSON islands per page; note disclosures; live verse references; confidence styling.

**P4 — Modes & small screens.** Mode toggle + persistence; tablet drawer; mobile sheet + translation disclosures; keyboard grammar.

**P5 — Transversal surfaces.** Chansons index table + concordance grid; bibliography backlinks; sigles page polish; printed-page resolver (`/pages/N`); citation tool.

**P6 — Search & indexes.** Pagefind with facets + Occitan folding; linked indexes (phase-1 page links; phase-2 word-index→verse resolution).

**P7 — Polish.** Print CSS, dark mode, a11y audit, perf audit, cross-browser sheet/drawer testing.

**Component inventory** (for the wireframe kit): masthead · breadcrumb · chanson switcher · mode toggle · left-rail sommaire/minimap · strophe block (oc + fr variants) · verse-number gutter · verse marker (point + range brace) · commentary panel (+ sync chip, lemma heading w/ verse quotation, note disclosure) · hovercard ×4 species · bottom sheet · drawer · tradition card · pager · citation popover · bib entry (+ backlinks) · index list · concordance grid · search dialog · page-milestone (Livre).

**Optional, later, worth naming:** TEI P5 export generated from the same structured data (scholarly interchange & archival longevity — an export target, not a rearchitecture); alignment layer to Rialto/BEdT identifiers per chanson (P.-C. numbers make this nearly free); recording embeds if performances ever materialize.

---

## 14. Summary of the recommendation

- **Model:** anchored parallel commentary — poem as hub, full continuous remarques in a scroll-synced panel, verse markers as entry points — wrapped in **three reading modes** (Lecture / Étude / Livre) that resolve the student-vs-scholar conflict a single layout cannot.
- **The data earns it:** lemma keys, strophe-aligned translation, resolved sigla/back-refs, and the page map make every interaction above a rendering problem, not a research problem.
- **The print is honoured, not imitated:** Livre mode and the `/pages/N` resolver keep full fidelity and citation compatibility, which is what licenses the digital reordering everywhere else.
- **The stack survives:** Eleventy static output, Tufte treatment retained where it belongs (linear prose, Livre footnotes), one small vanilla-JS enhancement layer, Pagefind for search. Fast, accessible, durable — and unlike anything currently available for a troubadour edition.
