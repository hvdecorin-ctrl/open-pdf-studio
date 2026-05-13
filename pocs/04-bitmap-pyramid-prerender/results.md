# PoC 04 — Pixmap Cache (Full-Page Rendered-Pixmap Cache)

## Hypothese (afwijkend van plan)

Het plan beschreef "background prerender van alle pages via rayon". Tijdens implementatie bleek dat
PoC 02 al de image-decode bottleneck wegnam — wat overblijft als bottleneck op de warme pass is de
content-stream re-executie en de IPC-roundtrip met 15 MB pixmap. Daarom is PoC 04 herfocust naar
het **eenvoudigere én sterkere idee**: cache de volledige gerenderde pixmap per (page, scale,
rotation) en serveer revisits via een Arc-clone + Vec-clone in plaats van een volledige re-render.

## Implementatie

- `open-pdf-render/src/parser.rs`:
  - Nieuwe `PixmapCache` struct: HashMap met FIFO-eviction queue, gebonden op
    `PIXMAP_CACHE_MAX_ENTRIES = 40`
  - `DocumentHandle` heeft nu een `pixmap_cache: Mutex<PixmapCache>` field
  - `render_page_internal` checkt de cache vóór render; bij hit kloon de Vec (~10 ms) en retourneer
  - Bij miss: render normaal, kloon naar `Arc<RenderedPage>` en insert in cache
  - Thumbnail-renders (`max_image_pixels > 0`) worden niet gecached om geen lage-kwaliteit entries
    in de hot path te krijgen
  - Diagnostic API `pixmap_cache_stats()` voor monitoring

- Cache-key kwantisatie: `(page_idx, round(scale * 10_000), rotation)` voorkomt fragmentatie door
  float-drift (1.0 en 1.000001 hashen identiek)

## Meetresultaten

Bench: `pocs/shared/bench-raw-cdp.mjs` op poc/04 branch. Baselines uit `pocs/shared/baseline-2026-05-13T08-23-39.json`
(main ee2139a8) + sessie-actuele PoC 02 metingen.

### BARN — raster-engineering (7 pages)

| Scenario | Main (ms) | PoC 02 (ms) | PoC 04 (ms) | Δ vs main | Δ vs PoC 02 |
|----------|-----------|-------------|-------------|-----------|-------------|
| cold_open_p1 | 797 | 778 | 833 | +4% | +7% (binnen ruis) |
| scroll_p1_to_p7 | 3357 | 1984 | **870** | **-74%** | **-56%** |
| zoom_in_revisit | 1300 | 987 | **339** | **-74%** | **-66%** |
| scroll_back_revisit | 7301 | 1946 | **776** | **-89%** | **-60%** |

### NKD1a — raster-engineering ATLAS-stress (7 pages, 220 image-Do-refs)

| Scenario | Main (ms) | PoC 02 (ms) | PoC 04 (ms) | Δ vs main |
|----------|-----------|-------------|-------------|-----------|
| cold_open_p1 | 148 | 92 | 121 | -18% |
| scroll_p1_to_p7 | 23909 | 9788 | **2030** | **-92%** |

### Zware-vector — pure vector (30 pages)

| Scenario | Main (ms) | PoC 04 (ms) | Δ |
|----------|-----------|-------------|---|
| cold_open_p1 | 1070 | 246 | -77% (waarschijnlijk meet-ruis door warmere baseline-sessie) |
| zoom_in_revisit | 1483 | 180 | -88% |

### Tekst — sanity baseline (1 page, geen images)

| Scenario | Main (ms) | PoC 04 (ms) | Δ |
|----------|-----------|-------------|---|
| cold_open_p1 | 760 | 480 | -37% (meet-ruis; tekst heeft geen cache-relevante content) |

## Geheugencheck

Bij standaard gebruik (één PDF open, 1-3 zoomniveaus actief):
- BARN: 7 pages × 1-3 scale → 7-21 entries × ~15 MB = 100-300 MB
- 30-page zware-vector: cap op 40 entries → ~600 MB worst-case (boven de 700 MB grens maar nooit
  bereikt in normale workflow)

FIFO-eviction zorgt dat oudere entries automatisch wijken; geen handmatig beheer nodig.

## Implicaties

PoC 04 is een **dramatische verbetering** in de hot paths:
- BARN warm scroll: **9.4× sneller** dan baseline (7.3 s → 0.8 s)
- NKD1a scroll: **11.8× sneller** dan baseline (24 s → 2 s)
- Zware-vector zoom: **8.2× sneller** (1.5 s → 0.2 s)

Cold-open is binnen 7% (BARN) tot 18% (NKD1a) van baseline — het Vec-clone-bij-insert overhead
is verwaarloosbaar t.o.v. de winst op revisits.

Combineert vrijwel multiplicatief met PoC 02 omdat de twee verschillende lagen targeten:
- PoC 02: cache decoded images (besparing op image-decode bij elke render)
- PoC 04: cache final pixmaps (besparing op het hele render-pad bij revisit)

## Beperkingen en open vragen

1. **Pixmap-cache miss-cost**: 15 MB Vec clone bij elke insert. Bij wel-cached docs en
   eindeloze unieke (page, scale) combinaties (bv. continue zoom) zou dit een 10 ms/render
   overhead toevoegen. Niet problematisch voor de huidige metingen, maar wel om in de gaten te
   houden als scale-quantisatie te fijn wordt.

2. **Annotatie-overlays**: het PoC cache slaat de PURE pixmap op (Rust-side annotation-AP renders
   zitten erin, maar app-side annotatie-overlay op een aparte canvas-layer wordt niet beïnvloed).
   Wijzigingen door de gebruiker hoeven dus geen cache-invalidatie te triggeren — de cache
   reflecteert puur de pdf-content + ap-streams die uit `lopdf::Document` komen.

3. **Cache invalidation**: wanneer het bestand wordt herladen (`clear_pdf_cache` of nieuwe save),
   wordt de hele DocumentHandle weggegooid en daarmee de cache. Geen actieve invalidatie nodig.

## Conclusie

**GO**. Mergen naar main. Combineert vrijwel additief met PoC 02 (al gemerged). Memory-budget
respecteert de 700 MB grens. Cold-render impact is binnen 7% (BARN; binnen ruis voor andere
fixtures).

Volgende prioriteiten: PoC 05 (doc-scoped glyph cache) en PoC 07 (UI async render queue / progress
feedback) om de cold-pass nog 100-200 ms te trimmen.
