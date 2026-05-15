# Ontwerp — PDFium renderer-swap + opschoning Open PDF Studio

**Datum:** 2026-05-15
**Branch:** `feat/fast-open-barn`
**Status:** Ontwerp ter review

## Doel

Vervang de Rust + `tiny-skia` PDF-renderer in `open-pdf-render` door **PDFium** (via de
`pdfium-render` Rust-crate) voor de raster-rendering van pagina's en thumbnails. Behoud de
vector-render path (`extract_draw_commands` → JS `vector-renderer.js`) als alternatieve hot-path
voor vector-zware PDFs. Schoon alle dood/duplicatie/PoC-infrastructuur op die niet meer relevant
is na de swap.

**Geen release.** Dit is een ingrijpende verandering op een test-branch. Niet mergen naar main,
geen versie-bump, geen GitHub draft release.

## Probleemstelling

De gebruiker constateerde dat BARN (25.5 MB engineering-PDF, 7 pagina's, 2448×1584 px) merkbaar
trager opent in Open PDF Studio dan in Edge/Chrome. Gemeten:

| Laag | Mediaan cold open BARN | Best case | Worst case |
|------|------------------------|-----------|------------|
| File read (25.5 MB) | 271 ms | 180 ms | 1239 ms |
| PDF parse (`get_page_dimensions`) | 35 ms | 23 ms | 381 ms |
| Render page 1 (Rust + tiny-skia) | 694 ms | 391 ms | 1856 ms |
| Render 1 thumbnail | 170 ms | 159 ms | 1483 ms |
| Alle 7 thumbnails | 1376 ms | 903 ms | 8340 ms |
| **Totaal cold open** | **3084 ms** | 2423 ms | 12166 ms |

Edge/Chrome openen dezelfde BARN in ~300-500 ms. Het verschil is structureel: zij gebruiken
PDFium (Google's C++ renderer, ~10 jaar productie-tuning, GPU-rasterization via Skia D3D11) waar
wij een eigen tiny-skia softrenderer hebben. Optimalisaties op het bestaande pad (PoC 02 doc image
cache + PoC 04 pixmap cache) hebben de warm-pass al 9× sneller gemaakt, maar de **eerste cold
render** blijft fundamenteel CPU-gelimiteerd op onze pure-Rust softrenderer.

PDFium's prebuilt Windows-x64 DLL via `pdfium-render` is hier de oplossing.

## Scope

**Scope A — Renderer-only swap**: vervang alleen de raster-render paden (`render_pdf_page`,
`render_thumbnail`). Behoud de vector-render path (`extract_draw_commands` →
`js/pdf/vector-renderer.js`) voor mogelijk hergebruik op vector-zware pagina's. `open-pdf-render`
blijft bestaan voor analyse-functies maar verliest de render-helft en alle bijbehorende caches.

## Architectuur

### Voor de swap

```
┌─ JS ─────────────────────────────────────────────────────────────┐
│  loader.js → renderer.js                                          │
│    ├─ analyze_page_type → "raster" → invoke('render_pdf_page')   │
│    │                                                              │
│    └─ analyze_page_type → "vector" → invoke('extract_draw_       │
│                                       commands') → vector-        │
│                                       renderer.js                 │
└──────────────────┬───────────────────────────┬───────────────────┘
                   │                           │
                   ▼                           ▼
┌─ src-tauri/src/lib.rs ──────────────────────────────────────────┐
│  render_pdf_page       analyze_page_type      extract_draw_      │
│       │                       │                   commands        │
└───────┼───────────────────────┼───────────────────┼──────────────┘
        │                       │                   │
        ▼                       ▼                   ▼
┌─ open-pdf-render ───────────────────────────────────────────────┐
│  DocumentHandle::render_page       ::analyze_page_type           │
│    ├─ interpreter::execute_internal   ::extract_draw_commands    │
│    │   ├─ predecode images          (alle 3 → interpreter::      │
│    │   ├─ render content stream      extract_commands → emits   │
│    │   │  via SkiaRenderer           DrawCommandBuffer)          │
│    │   ├─ glyph rendering            ◀── HOUDEN                  │
│    │   └─ doc_image_cache (PoC 02)                               │
│    ├─ render_annotation_appearance                               │
│    └─ pixmap_cache (PoC 04)                                      │
│         ◀── WEG                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Na de swap

```
┌─ JS ─────────────────────────────────────────────────────────────┐
│  loader.js → renderer.js                                          │
│    ├─ analyze_page_type → "raster" → invoke('render_pdf_page')   │
│    │                                                              │
│    └─ analyze_page_type → "vector" → invoke('extract_draw_       │
│                                       commands') → vector-        │
│                                       renderer.js                 │
└──────────────────┬───────────────────────────┬───────────────────┘
                   │                           │
                   ▼                           ▼
┌─ src-tauri/src/lib.rs ──────────────────────────────────────────┐
│  render_pdf_page       analyze_page_type      extract_draw_      │
│  (PDFium-backed)              │                   commands        │
│  render_thumbnail             │                                   │
│  (PDFium-backed)              │                                   │
└───────┬───────────────────────┼───────────────────┼──────────────┘
        │                       │                   │
        ▼                       ▼                   ▼
┌─ pdfium-render ──┐  ┌─ open-pdf-render (trimmed) ─────────────┐
│  Pdfium::default │  │  DocumentHandle::analyze_page_type      │
│  load_pdf_from_  │  │    ::extract_draw_commands              │
│   file/_byte_    │  │    ::extract_draw_commands_batch        │
│  page.render_    │  │    ::page_count, page_dimensions_all    │
│   with_config    │  │    (interpreter::extract_commands path) │
│  as_rgba_bytes   │  │                                          │
└──────────────────┘  └──────────────────────────────────────────┘
```

## Componenten

### Componenten — nieuw

**`pdfium-render` (Cargo dep, v0.9.x)**
- Crate die de PDFium C API wraps. Dynamische linking is de default — PDFium DLL wordt at
  runtime ingeladen.
- License: MIT/Apache. PDFium zelf: BSD-3-Clause via Google.

**PDFium DLL (Windows x64)**
- Source: `https://github.com/bblanchon/pdfium-binaries/releases` (prebuilt Microsoft Edge build)
- Bestandsnaam: `pdfium.dll` (~14 MB)
- Plaatsing in repo: `open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll`
- Bundeling via Tauri `tauri.conf.json` → `bundle.resources` → kopieert naar `resources/`
  naast `open-pdf-studio.exe` bij installer-build
- Runtime resolver: `Pdfium::bind_to_library` met expliciete path naar `resource_dir/pdfium.dll`

**Tauri command — `render_pdf_page` (vervangt huidige Rust-impl)**
- Signature blijft identiek: `(path, page_index, scale, rotation) → Result<Response, String>`
- Wire format blijft identiek: `[width: u32 LE][height: u32 LE][rgba bytes...]`
- Implementatie via PDFium:
  1. Open document via `pdfium.load_pdf_from_file(path, None)` (memory-mapped IO door PDFium)
  2. Pak `page = document.pages().get(page_index)`
  3. Bouw `PdfRenderConfig::new().set_format(PdfBitmapFormat::BGRA).set_target_width((scale × page_width).ceil()).set_target_height((scale × page_height).ceil()).render_form_data(true).set_rotation(...)` — `render_form_data(true)` zet de `FPDF_ANNOT` flag aan voor /AP rendering
  4. `bitmap = page.render_with_config(&config)`
  5. `let rgba = bitmap.as_rgba_bytes()` — converteert BGRA → RGBA als nodig
  6. Bouw response `[width LE][height LE][rgba...]`

**Tauri command — `render_thumbnail` (vervangt huidige Rust-impl)**
- Signature en wire format (data URL string) ongewijzigd
- Implementatie via PDFium met lage scale, zelfde render-config-pattern, JPEG-encoding via
  bestaande `image` crate

**DocHandle cache adapter**
- Vervang `Mutex<HashMap<String, Arc<open_pdf_render::DocumentHandle>>>` (huidige
  `DocHandleCache`) met een tweede cache `Mutex<HashMap<String, Arc<PdfiumDocumentHandle>>>` waar
  `PdfiumDocumentHandle` een wrapper is rond `PdfDocument<'static>` om de lifetime-beperking van
  pdfium-render te omzeilen via `'static`-bind aan een global Pdfium instance.
- De bestaande open-pdf-render `DocHandleCache` blijft bestaan voor `extract_draw_commands` etc.

**Pdfium global instance**
- `static PDFIUM: OnceLock<Pdfium> = OnceLock::new();`
- Init in `lib.rs` `run()` startup, vóór registratie van Tauri commands
- Bij init-failure (DLL missing/corrupt): paniek tijdens app-start met duidelijke error.
  Dat is acceptabel omdat de DLL bij de installer hoort en niet ontbreken kan zonder corrupt
  installatie.

### Componenten — onveranderd

- Alle annotation rendering in `js/annotations/` (alle 25+ types: draw, line, arrow, arc, spline,
  polyline, circle, box, polygon, cloud, cloudPolyline, comment, text, textbox, callout, image,
  textHighlight, textStrikethrough, textUnderline, stamp, signature, parametricSymbol,
  measureDistance, measureArea, measureAngle, hatch-patterns enz.)
- `js/pdf/saver.js` + pdf-lib save-flow
- `js/pdf/loader/annotation-converter.js`
- `js/text/` (PDF.js text layer)
- Vector render path: `js/pdf/vector-renderer.js`, `js/pdf/pdf-viewport.js`,
  `analyze_page_type`, `extract_draw_commands*`
- `xfdf` import/export
- Tauri-bundling, plugin-systeem, MCP-server commands

### Componenten — verwijderd

**Uit `open-pdf-render`:**
- `src/renderer.rs` (SkiaRenderer + alle tiny-skia helpers)
- `DocumentHandle::render_page`, `::render_page_with_image_limit`, `::render_page_internal`
- `DocumentHandle::pixmap_cache` field + `PixmapCache` struct + alle helpers (PoC 04)
- `DocumentHandle::doc_image_cache` field + `ImageCache` type + alle seed/merge logic (PoC 02)
- `interpreter::execute_internal` rendering paths (`handle_image_execute`,
  `handle_path_paint`, glyph-rasterization helpers, `predecode_images_parallel`,
  `CachedDecodedImage`)
- `interpreter::render_annotation_appearance`
- Cargo deps: `tiny-skia`, `turbojpeg`, `image` (laatste mogelijk behouden door thumbnail JPEG
  encoding — wordt bij PDFium swap weer overbodig)
- `examples/barn_deep_dive.rs`, `probe_type1.rs`, `profile_image_stages.rs`, `profile_render.rs`,
  `render_page_literal.rs`, `inspect_page.rs`
- `extract_text_spans`, `extract_text_spans_batch` (dead, geen JS-consumer)

**Uit `src-tauri/src/lib.rs`:**
- Render-path code in `render_pdf_page` (vervangen door PDFium)
- Render-path code in `render_thumbnail` (vervangen door PDFium)

**Uit `open-pdf-studio/js/`:**
- `js/text/rust-text-extraction.js` (dead, geen import)
- `FEATURE_TILE_RENDERING` flag + tile-render code-paden in `renderer.js`

**Uit repo-root:**
- `_iter34_pymupdf_xref517.ttf`, `_iter34_pymupdf_xref522.pfa` (debug font-extracts)

**Uit `mcp-server/`:**
- `bench-barn-perf.mjs`, `bench-ipc-overhead.mjs`, `diag-tile-render.mjs`, `test-symbols-cdp.mjs`,
  `test-tauri-cdp.mjs`, `test-zoom-pan.mjs`, `read-rotation-log.mjs`
- Debug PNGs/JPGs: `current-text.png`, `final-check.png`, `stamp-after-fix.jpg`,
  `stamp-final-check.jpg`
- Behouden: `check-app-state.mjs` (algemene MCP debug-tool, breed bruikbaar)

## Data flow — render een page

1. **JS** roept `invoke('render_pdf_page', { path, pageIndex, scale, rotation })`
2. **Tauri command** in `lib.rs`:
   a. `get_or_load_pdfium_doc(path, cache)` — pakt cached `PdfiumDocumentHandle` of opent via
      `pdfium.load_pdf_from_file(path, None)` en cached
   b. `let page = doc.pages().get(pageIndex)?;`
   c. Bouw `PdfRenderConfig` met `target_width`, `target_height`, rotation, `render_form_data(true)`
   d. `let bitmap = page.render_with_config(&config)?;`
   e. `let rgba_bytes = bitmap.as_rgba_bytes()`
   f. Bouw response `[w u32 LE][h u32 LE][rgba bytes...]`
   g. Return als `tauri::ipc::Response::new(buffer)`
3. **JS** ontvangt buffer, parses header, schrijft naar canvas — pad ongewijzigd

## Error handling

**DLL ontbreekt of corrupt bij app-start**
- `Pdfium::bind_to_library(resource_dir / "pdfium.dll")` retourneert `Result`
- Bij `Err`: log een fatale fout, toon dialog "PDFium engine ontbreekt — herinstalleer Open PDF
  Studio", exit code 1. App start dus niet zonder bruikbare DLL.
- Reden: zonder PDFium kan geen enkele PDF gerendered worden. Geen graceful degradation mogelijk
  binnen Scope A.

**PDF kan niet worden geopend door PDFium (corrupt, encrypted unsupported algo, etc.)**
- `pdfium.load_pdf_from_file` retourneert `Err`
- Tauri command retourneert `Err("Failed to load PDF: <message>")` — bestaande error-pad in JS
  toont user-friendly melding

**Render-failure op specifieke page (out-of-memory, gigantic image)**
- `page.render_with_config` retourneert `Err`
- Identiek error-pad als nu

**Page-index out of range**
- `document.pages().get(idx)` retourneert `Err`
- Identiek error-pad als nu

## Testing

### Visuele regressie

Manuele inspectie op de vier corpus-PDFs (`barn`, `nkd1a`, `zware-vector`, `tekst`) plus 5
willekeurige PDFs uit `test pdf-bestanden/Originele bestanden/`:
- Open elke PDF, scroll door alle pagina's op scale 1.0
- Vergelijk visueel met de huidige (tiny-skia) render via een tweede instance van de app op
  `main` branch
- Verifieer: tekst leesbaar, vector-tekeningen correct, raster-afbeeldingen aanwezig, /AP
  annotation-streams zichtbaar (sticky notes uit Acrobat etc.)

**Geen pixel-diff parity test toegevoegd.** PDFium en PyMuPDF zijn andere engines — pixel-diff
zal voorspelbaar afwijken. Voor pixel-diff parity tests blijft het `feat/skia-renderer-plan-a` en
de `main` snapshot beschikbaar als historische referentie.

### Performance

Bench-harness draaien op `pocs/shared/bench-raw-cdp.mjs`:
- `cold_open_p1` op `barn`, `nkd1a`, `tekst`, `zware-vector`
- `scroll_p1_to_p7` op `barn`, `nkd1a`
- `zoom_in_revisit` op `barn`, `zware-vector`

End-to-end bench draaien op `pocs/shared/bench-layers.mjs` voor BARN.

**Succescriterium (alle vier moeten)**:
- BARN `cold_open_p1` < 400 ms (huidige 833 ms; minimaal 50% reductie)
- BARN `scroll_p1_to_p7` < 1500 ms — pixmap cache vervalt; voor cold-passes wint PDFium, voor
  warm-passes zonder cache betalen we per page de render-tijd opnieuw. Bench zal aantonen of de
  netto-impact gunstig is.
- Geen regressie > 20% op `cold_open_p1` van `tekst`, `zware-vector`, `nkd1a`
- 7-thumbnails BARN < 700 ms (huidige 1376 ms)

### Functionele tests

Per annotation-categorie (line, hatching, comment, stamp, measure-distance, etc.): maak een
annotatie, sla op, herlaad het document, verifieer dat de annotatie nog correct getoond + bewerkt
kan worden. Geen geautomatiseerde test toegevoegd in deze branch (te grote scope) — manuele
verificatie tijdens implementatie.

## Implementatie-fasering

1. **Dood code opschonen** (geen functioneel risico)
   - Verwijder `js/text/rust-text-extraction.js`
   - Verwijder `extract_text_spans`/`_batch` uit `open-pdf-render` + Tauri command
   - Verwijder `_iter34_pymupdf_xref*.{ttf,pfa}`
   - Verwijder `mcp-server/{bench-barn-perf,bench-ipc-overhead,diag-tile-render,test-symbols-cdp,test-tauri-cdp,test-zoom-pan,read-rotation-log}.mjs`
   - Verwijder debug-images uit `mcp-server/`
   - Verwijder `open-pdf-render/examples/*.rs`
   - Verwijder `FEATURE_TILE_RENDERING` + tile-paths in `renderer.js`

2. **PDFium-integratie toevoegen** (additief — naast bestaande render)
   - Voeg `pdfium-render` toe aan `src-tauri/Cargo.toml`
   - Download PDFium DLL naar `src-tauri/binaries/win-x64/pdfium.dll`
   - Tauri bundle config — kopieer DLL naar resources
   - Add `static PDFIUM` global init in `lib.rs` `run()` startup
   - Add `PdfiumDocumentHandle` wrapper + `pdfium_doc_cache` state
   - Add `get_or_load_pdfium_doc` helper

3. **Tauri-commands omzetten naar PDFium**
   - `render_pdf_page`: vervang body door PDFium-implementatie
   - `render_thumbnail`: vervang body door PDFium-implementatie
   - Visuele regressie-check (zie Testing)
   - Performance bench (zie Testing)

4. **`open-pdf-render` render-helft verwijderen**
   - Verwijder `SkiaRenderer`, render-paden in `execute_internal`,
     `render_annotation_appearance`
   - Verwijder `pixmap_cache` (PoC 04), `doc_image_cache` (PoC 02)
   - Verwijder Cargo deps `tiny-skia`, `turbojpeg`, `image`
   - Verifieer dat `extract_draw_commands` + `analyze_page_type` nog werken
   - Cargo build clean

5. **PoC results archiveren**
   - `pocs/02-doc-image-cache/results.md` + `pocs/04-bitmap-pyramid-prerender/results.md` →
     `docs/superpowers/historical/poc-02-04-results.md` (samengevoegd, met annotatie "vervangen
     door PDFium swap 2026-05-15")

Fase 1 + 2 zijn additief en kunnen al gemerged worden zonder breaking changes. Fase 3 is de
swap; fase 4 is de cleanup. Iedere fase eindigt in een commit.

## Non-goals

- **Geen PDFium voor extract_draw_commands / analyze_page_type / extract_text_spans**: PDFium
  heeft eigen `FPDFText_*` API die deze functies kan vervangen, maar dat is Scope B. De vector
  render path blijft op `open-pdf-render`.
- **Geen Mac / Linux DLL bundeling in deze branch**: alleen Windows x64. Andere platforms zijn een
  separate spec.
- **Geen feature-flag tussen oude en nieuwe engine**: cold cut-over. Voor terugval bestaat de
  `main` branch + git history.
- **Geen PoC 06 / 07 / 08 implementatie** in deze branch: PoC 07 (UI progressive feedback) en
  PoC 08 (thumbnail-first opening) blijven open.
- **Geen aanpassing aan in-app annotation rendering**: `js/annotations/*` is 100% ongewijzigd.
- **Geen automated regression tests** voor visuele output. Manuele inspectie volstaat in deze
  test-branch.
- **Geen release**: niet mergen naar main, geen versie-bump, geen GitHub-release.

## Vragen / risico's voor implementatie

1. **PDFium thread-safety**: PDFium-core API is single-threaded. `pdfium-render` lost dit op door
   alle calls via een internal mutex te serialiseren. Voor parallel page-renders is dit een
   mogelijke bottleneck — verifieer tijdens fase 3 dat parallelle Tauri-commands geen contentie
   geven die de cold-open winst tenietdoet.

2. **PDFium licentievermelding**: BSD-3-clause vereist attributie. Voeg `NOTICE.txt` toe of
   update bestaande licentie-pagina in de app's "About"-dialog.

3. **PDFium DLL grootte**: ~14 MB extra bovenop ~30 MB installer. Acceptabel maar noteren voor
   release-notes (later).

4. **Static link vs dynamic link**: pdfium-render ondersteunt beide. Dynamic gekozen voor
   simpelste integratie. Static link geeft kleinere installer (alles in `.exe`) maar vereist
   PDFium source-build — buiten scope voor deze branch.

5. **Existing PoC test infrastructure**: `pocs/shared/bench-*.mjs` blijft bruikbaar — meet via
   `invoke('render_pdf_page')` ongeacht backend.

## Stop-criteria

Stoppen en terug naar `main` als:
- BARN cold-open na fase 3 niet onder de 400 ms uitkomt (PDFium init blijkt traag op Tauri/WebView2
  combinatie of DLL load-overhead bij elke render)
- Visueel verschil met huidige rendering te groot is op de corpus (waarschijnlijk geen issue —
  PDFium is wat Chrome gebruikt)
- DLL bundeling via Tauri-bundler niet werkt op Windows
- Een annotation-categorie blijkt te breken op iets onverwachts

Bij stop: branch behouden voor toekomstige iteratie, geen merge.
