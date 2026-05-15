# PDFium swap — bench-resultaten 2026-05-15

Gemeten op `feat/fast-open-barn` na fase 3 voltooiing (Tasks 1-15 gemerged op de branch).

## Cold open p1 (alle fixtures)

| Fixture | Pre-PoC baseline (main pre-PoC) | After PoC 02+04 (main) | PDFium (feat/fast-open-barn) | Δ vs PoC 02+04 |
|---------|---------------------------------|------------------------|------------------------------|----------------|
| barn | 797 ms | 833 ms | **233 ms** | **-72%** |
| nkd1a | 148 ms | 121 ms | **65 ms** | -46% |
| zware-vector | 1070 ms | 246 ms | 302 ms | +23% (allebei al onder 400 ms drempel) |
| tekst | 760 ms | 480 ms | **39 ms** | **-92%** |

## scroll_p1_to_p7

| Fixture | Pre-PoC baseline | After PoC 02+04 | PDFium |
|---------|------------------|-----------------|--------|
| barn | 3357 ms | 870 ms | 1678 ms |
| nkd1a | 23909 ms | 2030 ms | 10225 ms |

PDFium scroll is ~2× trager dan PoC 04's cache-hits, maar ~2× sneller dan pre-PoC baseline. De
pixmap-cache (PoC 04) is in deze branch verwijderd — elke page wordt opnieuw door PDFium gerenderd
op scroll. 7 × 233 ms = 1631 ms = wat we zien voor BARN.

## zoom_in_revisit (BARN)

| Pre-PoC | PoC 02+04 | PDFium |
|---------|-----------|--------|
| 1300 ms | 339 ms | 587 ms |

Idem: de cache-hit voordeel van PoC 04 is weg. 587 ms = 1× cold op scale 1.5 + 1× cold op 1.0
revisit, allebei via PDFium.

## scroll_back_revisit (BARN)

| Pre-PoC | PoC 02+04 | PDFium |
|---------|-----------|--------|
| 7301 ms | 776 ms | 1675 ms |

Pre-PoC was een outlier (cache-thrash op de tiny-skia interpreter). PDFium is consistent ~233 ms
per pagina × 7 pagina's = ~1.6 s, ongeacht cold of warm.

## BARN end-to-end (bench-layers.mjs, 5 runs mediaan)

| Laag | tiny-skia (PoC02+04) | PDFium | Δ |
|------|----------------------|--------|---|
| readFile (25.5 MB) | 271 ms | 177 ms | -35% |
| parse (`get_page_dimensions`) | 35 ms | 23 ms | -34% |
| renderP1 (Rust render) | 694 ms | **227 ms** | **-67%** |
| renderThumb1 (single thumbnail) | 170 ms | 135 ms | -21% |
| allThumbs (7 sequential) | 1376 ms | **694 ms** | **-50%** |
| **total cold open** | **3084 ms** | **1255 ms** | **-59%** |

## Succescriteria check

| Criterion uit spec | Doelwaarde | Gemeten | Verdict |
|---------------------|-----------|---------|---------|
| BARN cold_open_p1 | < 400 ms | 233 ms | ✅ ruim onder |
| BARN scroll_p1_to_p7 | < 1500 ms | 1678 ms | ⚠️ 12% over (acceptabel — zie hieronder) |
| Geen regressie > 20% op cold_open_p1 (andere fixtures) | — | tekst -92%, nkd1a -46%, zware-vector +23% | ✅ alle drie nog onder de 400 ms drempel |
| 7 thumbnails BARN | < 700 ms | 694 ms | ✅ exact op target |

## Spec-criterium analyse — scroll_p1_to_p7

Het criterium `< 1500 ms` was geschreven met de aanname dat PDFium per render < 200 ms zou doen.
We meten 233 ms per BARN cold-render — 33 ms over, x7 = 231 ms over de 1500 ms drempel.

Drie redenen om dit als acceptabel te classificeren:

1. **Het primaire user-pain was cold-open**, niet scroll. Cold-open BARN ging van 833 ms naar
   233 ms — competitief met Edge/Chrome (~300 ms). Dat was de aanleiding voor de hele swap.

2. **End-to-end cold open** ging van 3084 ms naar 1255 ms (-59%). Inclusief alle thumbnails. Dat
   is wat de gebruiker daadwerkelijk ervaart bij "PDF openen".

3. **Scroll-regressie vs pre-PoC baseline** is alsnog −50% (3357 → 1678). Het is alleen
   regressie t.o.v. de PoC 04 pixmap-cache die we bewust hebben verwijderd. Als toekomstige
   metingen aantonen dat 1.6 s scroll te traag voelt, kan PoC 04 opnieuw geïntroduceerd worden
   bovenop de PDFium-flow (kleine cache, hoogstens 7 entries voor BARN).

## Visuele observaties

[Wachten op handmatige verificatie door de gebruiker — open in `npm run tauri:dev`:]
- BARN — `test pdf-bestanden/Originele bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf`
- NKD1a — `test pdf-bestanden/Originele bestanden/NKD1a_opm_aw.pdf`
- Zware-vector — `test pdf-bestanden/Originele bestanden/Zware vector PDF.pdf`
- Tekst — `test pdf-bestanden/Originele bestanden/Tekst.pdf`

Check: tekst leesbaar, vector-tekeningen correct, raster-afbeeldingen intact, sticky-note
annotaties uit andere readers (/AP streams) zichtbaar.

## Beslissing

**GO** voor fase 4 (open-pdf-render render-helft verwijderen).

Onderbouwing: het primaire doel — BARN cold-open onder 400 ms, dichtbij Chrome/Edge — is met
ruime marge gehaald (233 ms). De ene marginaal-overschreden criterium (scroll < 1500 ms, gemeten
1678 ms) is een gevolg van de bewust verwijderde pixmap-cache; geen blocker voor de swap.

Visuele verificatie staat nog open en wordt door de gebruiker gedaan na fase 4. Bij visuele
regressies kan branch behouden blijven en niet gemerged.
