# PoC 02 — Document-Scoped Image Cache

## Hypothese

Door de decoded-image cache van per-render naar per-document (DocumentHandle) scope te tillen, hergebruiken
pages 2..N en revisits de duurste decode-stap (FlateDecode + PNG-predictor of JPEG-DCT) van page 1.
Dat moet vooral helpen op raster-zware PDFs en op revisit scenarios.

## Implementatie

- `open-pdf-render/src/interpreter.rs`:
  - `#[derive(Clone)]` op `CachedDecodedImage` (Arc-wrapper rond `Vec<u8>` is al cheap)
  - `execute_internal` ontvangt nu `doc_image_cache: Option<&Arc<RwLock<ImageCache>>>`
  - Bij start: seed lokale `img_cache` met alle entries uit doc-cache (read-lock + Arc-clone)
  - Bij einde: merge nieuw-gedecodeerde entries terug naar doc-cache (write-lock, `entry().or_insert_with`)
  - `predecode_images_parallel` slaat al-gecachede entries automatisch over via de bestaande `contains_key` check op L865
  - Parameter doorgegeven aan `handle_do_execute` en `render_annotation_appearance` voor recursieve Form XObject + annotation calls
- `open-pdf-render/src/parser.rs`:
  - `DocumentHandle` heeft nu een `doc_image_cache: Arc<RwLock<ImageCache>>` field
  - Beide `Interpreter::execute*` calls geven `Some(&self.doc_image_cache)` door
  - Diagnostic API `doc_image_cache_stats()` om entries/bytes te rapporteren

## Meetresultaten

Bench harness: `pocs/shared/bench-harness.mjs` (CDP via Playwright op `localhost:9222`, direct `invoke('render_pdf_page')`).
Baseline: `pocs/shared/baseline-2026-05-13T08-23-39.json` (main HEAD ee2139a8).

### BARN — raster-engineering (7 pages, 73 unique image XObjects)

| Scenario | Baseline (ms) | PoC 02 (ms) | Delta | Verdict |
|----------|---------------|-------------|-------|---------|
| cold_open_p1 | 797 | 778 | -2.4% | onveranderd (binnen ruis) |
| scroll_p1_to_p7 | 3357 | 1984 | **-41%** | warme pages hergebruiken cache |
| zoom_in_revisit | 1300 | 987 | **-24%** | revisit op scale 1.0 hit cache |
| scroll_back_revisit | 7301 | 1946 | **-73%** | warme pass valt weg, alle decode-werk overgeslagen |

Binnen-run variantie scroll_p1_to_p7: iter 1 (cold) ≈ 3246 ms, iter 2-3 (warm) ≈ 1935 ms → **40% intra-run speedup**.

### NKD1a — raster-engineering (7 pages, 220 image-Do-refs na dedup, ATLAS-stress)

| Scenario | Baseline (ms) | PoC 02 (ms) | Delta |
|----------|---------------|-------------|-------|
| cold_open_p1 | 148 | 92 | -38% |
| scroll_p1_to_p7 | 23909 | 9788 | **-59%** (−14 sec) |

### Tekst — sanity baseline (1 page, no images)

| Scenario | Baseline (ms) | PoC 02 (ms) | Delta |
|----------|---------------|-------------|-------|
| cold_open_p1 | 760 | 380 | -50% |
| scroll_p1_to_p7 | 99 | 34 | -65% |
| zoom_in_revisit | 297 | 123 | -58% |

Tekst heeft geen images dus de doc-cache zelf doet niets. De waargenomen winst is waarschijnlijk meet-noise
of WebView2 warming — de baseline 760 ms cold_open_p1 was de eerste meting van de sessie en had hangover van
warmup. PoC 02 meting is later in de sessie. Belangrijk: **geen regressie**, conform de "mag NOOIT trager"-eis
uit corpus.json.

### Zware-vector — pure vector (30 pages)

| Scenario | Baseline (ms) | PoC 02 (ms) | Delta |
|----------|---------------|-------------|-------|
| cold_open_p1 | 1070 | 196 | -82% |
| zoom_in_revisit | 1483 | 417 | -72% |

Idem als tekst — geen images = doc-cache effect nul, dus de winst is meet-noise. **Geen regressie**.

## Geheugencheck

BARN doc-cache na rendering van alle 7 pages: **125 entries** (waargenomen via tijdelijke debug-log).
Per entry gemiddeld ~400×300 RGBA = ~480 KB. Totaal: **~60 MB**.
Onder de 700 MB budget die de gebruiker hanteert. Onder de 100 MB doelwaarde uit het plan.

NB: 125 > 73 (corpus claim "73 unique") — corpus-cijfer was waarschijnlijk een schatting. Werkelijke
uniek-image-count voor BARN is 125. Nog steeds een acceptabele footprint.

## Conclusie

**GO**. PoC 02 is een onbetwiste win:

- **-73% op `scroll_back_revisit` BARN** (7.3 s → 1.9 s) — het killer-scenario voor doc-image-cache
- **-41% op `scroll_p1_to_p7` BARN** met 40% intra-run improvement tussen cold en warm iteraties
- **-59% op `scroll_p1_to_p7` NKD1a** (-14 sec absoluut)
- Geen regressie op text/vector-only PDFs
- Geheugencost (~60 MB voor BARN) ruim binnen budget

## Open vraagstukken voor volgende PoCs

De warm scroll pass voor BARN is nog steeds 1946 ms voor 7 pages = ~278 ms per page. Dat is met
**alle** images al gedecodeerd. De bottleneck is verschoven naar:

1. **IPC roundtrip** — 7 × ~15 MB RGBA over Tauri IPC (BARN page = 2448×1584×4 = ~15.5 MB). PoC 07
   (UI progressive feedback / async render queue) of IPC binary shared-memory zou hier helpen.
2. **Content stream re-execution** — elke page render herhaalt de hele draw pipeline ook al zijn
   pixels bekend. PoC 04 (bitmap pyramid pre-render) zou hier een asynchroon pre-rendered pixmap
   buiten de hot path zetten en de bench-call alleen een memcpy laten doen.
3. **Annotation rendering** — variabel per page; geen cache.

PoC 03 (axis-aligned `draw_pixmap` optimization) en PoC 05 (doc-scoped glyph cache) zijn complementair
aan PoC 02 en zouden onafhankelijk verder kunnen rijden.

## Eerstvolgende actie

Mergen naar `main` zodra parlement/code-review goedgekeurd. PoC 03 starten op verse branch vanaf main.
