# Unified Pan/Zoom Model — Design Spec

**Status:** Draft, awaiting user review
**Date:** 2026-05-15
**Author:** Claude (under user direction)
**Tracks:** branch `feat/fast-open-barn`

## Goal

Vervang het huidige twee-paden render-model (bitmap-mode voor raster PDFs zoals BARN, vector-mode voor pure-vector PDFs) door één unified model. Adopteer free pan/zoom UX (cursor-anchor altijd respecteren, vrij pannen voorbij page-randen). Elimineer de race-condities, predictive-resize bugs, en tile-overlay flits die de gebruiker rapporteert.

## Background

### Wat er nu mis is

Drie dagen aan bug-reports van de gebruiker over zoom-gedrag bij BARN p.2 (raster PDF, ~1632pt breed):

1. **"Flits van een ander beeld" bij langzaam zoomen.** Oorzaak: tile-overlay DOM canvas (`#pdf-canvas-tile`) blijft zichtbaar tijdens een nieuwe `renderPage()`. Predictive CSS resize verandert canvas-container breedte, tile blijft op oude absolute `left:` positie, oude crisp tile content komt op verkeerde page-coördinaten te liggen — overlapping crisp+blurry beelden die verschillende page-regio's tonen.

2. **"Geen fixatie rondom mijn muis"** bij wheel-zoom. Oorzaak (deels gefixed v1.49.0): `doc.scale` werd synchroon geüpdatet door `zoomIn()` maar de predictive canvas CSS resize gebeurde pas na `await analyze_page_type` (50-300ms window). Tijdens dat window las een tweede wheel-event de nieuwe `doc.scale` en de oude `canvasRect.width`, met fractie-anker formule kapot. Gefixed door schaal-onafhankelijke `fractionX/Y`, maar root cause (twee verschillende state-sources die uit sync kunnen lopen) blijft.

3. **"Pan-maximum"** — gebruiker kan niet voorbij page-randen pannen. Oorzaak: `clampAndCenter()` clampte offsets per frame; native browser-scroll clampt op `[0, scrollWidth - clientWidth]`. Gefixed in v1.49.0 door clampAndCenter no-op en `safe center` → `flex-start`, maar het scroll-model laat nog steeds geen over-pan toe.

4. **Race-condities bij snelle zoom-burst.** N rapid wheels stapelen N renderPage calls die elk hun eigen `doc.scale` zien, hun eigen analyze-await doen, en allemaal proberen te painten. Een gen-counter logica filtert stale renders, maar het feit DAT er meerdere renders in flight zijn is zelf de bron van complexiteit. Cache-hits en cold-renders racen om de canvas. Pre-renders consumeren de Rust-thread tijdens de zoom.

### Architectuurprobleem

Twee paden:

- **Bitmap-mode** (raster, BARN): canvas-element heeft variabele grootte = pageW × scale × dpr. Pannen via browser-native `container.scrollLeft/Top`. Zoom muteert `doc.scale`, dan canvas-resize, dan PDFium render, dan paint. Predictive CSS-stretch voor instant feedback. Tile-overlay als aparte DOM canvas erbovenop voor crispness bij hoge zoom.

- **Vector-mode** (pure vector): canvas-element heeft vaste grootte = container. Pannen via `viewport.offsetX/Y`. Zoom muteert `viewport.zoom`. RAF render-loop tekent elke frame met `setTransform(zoom, 0, 0, zoom, offsetX, offsetY)` en speelt draw-commands af.

Twee paden delen geen state. Bug-fixes moeten dubbel. Het bitmap-pad heeft alle race-condities; het vector-pad is bijna schoon.

## Architecture

### Eén pad, één state, één paint-loop

Alle PDFs (raster én vector) gebruiken hetzelfde model. Canvas-element is vaste container-grootte. Pan/zoom muteert `viewport.offsetX/Y/zoom`. RAF render-loop tekent elke frame op basis van deze state:

```
_render() per frame (≤16ms):
  1. clearRect(canvas)
  2. fill gray background
  3. if (rasterBitmap available):
       ctx.drawImage(rasterBitmap, srcRect, destRect)
         destRect = (offsetX*dpr, offsetY*dpr, pageW*zoom*dpr, pageH*zoom*dpr)
  4. if (zoom > capZoom && tileBitmap available):
       ctx.drawImage(tileBitmap, srcRect, destRect)
         destRect = visible-region rectangle in canvas space
  5. if (vectorContent available):
       renderVectorPage(ctx, transform=(zoom, offsetX, offsetY))
  6. sync text-layer transform (CSS matrix)
  7. trigger annotation overlay redraw
```

Paint-tijd: ≤1 ms voor één à twee `drawImage` calls. **Full 60 FPS pan en zoom** tijdens user-interactie, zonder Rust-calls in de hot path.

Async Rust-renders fillen de bitmap-cache:
- **Whole-page bitmap**: gerendered per `(file, page, zoom-bucket, rotation)` waar `zoom-bucket` = preset zoom level afgerond. Cache permanent tijdens sessie (LRU max 16).
- **Tile bitmap**: alleen bij `zoom > capZoom`. Gerendered per `(file, page, zoom-bucket, viewportRegion-rounded-to-buffer)`. Re-rendered op pan-buiten-buffer en op zoom-change.

Beide via bestaande Rust commands `render_pdf_page` (whole) en `render_pdf_page_region` (tile). Geen wijziging aan Rust.

### Resolutie strategie

Voor whole-page bitmap:

```
desiredPx = pageW * zoom * dpr     // wat 1:1 nodig zou zijn

if desiredPx <= CAP (4096):
    render at desiredPx, crisp 1:1 drawImage
else:
    render at CAP, drawImage upscales (browser bilinear, blurry)
    AND render tile at full requested resolution for visible region
```

Tile is alleen aanwezig bij hoge zoom. Augment, niet vervanger.

Tile cache-buffer: tile rendert een visible region + 25% padding rondom. Pannen binnen padding = cache hit. Pannen voorbij = async tile re-render (whole-bitmap blijft tonen tot tile arriveert).

### Pan/zoom event flow

| Event | Handler |
|-------|---------|
| Click+drag (hand-tool) | `mousedown` capture (x, y, offsetX, offsetY) → `mousemove` set `offsetX += dx; offsetY += dy; dirty=true` → `mouseup` stop |
| Wheel zonder ctrl | `addPanVelocity(dx, dy)` → momentum RAF loop muteert offsetX/Y |
| Wheel met ctrl (zoom) | `zoomStepAtPoint(cursorX, cursorY, direction)` → sync `_anchorAt()` muteert offsetX/Y + zoom |
| Trackpad pinch (synthetic wheel + ctrl) | Accumulator → threshold → `zoomStepAtPoint()` |
| Touchpad two-finger pan | `addPanVelocity()` |
| Keyboard arrows (toekomst) | `offsetX/Y += step; dirty=true` |
| Status-bar zoom input | `setZoomAtPoint(canvasW/2, canvasH/2, newZoom)` |
| Fit Page (F-toets) | `fitToViewport()` — explicit center + zoom-fit |

**Geen clamp**. Geen `clampAndCenter()`, geen scroll-bounds. User kan page volledig off-screen pannen. Fit-Page is de recovery.

### Layer sync

#### Text layer (PDF.js spans voor selection + search)

```
spans:        gemaakt op scale=1 in PDF-point units (eenmalig per page)
container:    position: absolute; left: 0; top: 0;
              width: pageW (in points); height: pageH;
              transform: matrix(zoom, 0, 0, zoom, offsetX, offsetY);
              transform-origin: 0 0;
              --total-scale-factor: 1
```

Volgt viewport per frame zonder DOM-updates. Geen text-layer re-creation op zoom.

#### Annotation overlay canvas

```
fixed size:   container.clientWidth × clientHeight (matches main canvas)
ctx:          setTransform(zoom*dpr, 0, 0, zoom*dpr, offsetX*dpr, offsetY*dpr)
              draw all annotations in PDF-coords
```

### State model

`viewport` singleton (in `pdf-viewport.js`) blijft single source of truth:

```js
viewport = {
  active: true,                  // altijd true in unified model
  filePath: string,
  pageNum: 1-based,
  pageW: PDF points,
  pageH: PDF points,
  originX: MediaBox offset,
  originY: MediaBox offset,
  rotation: 0|90|180|270,
  zoom: 1.0,                     // huidige zoom (1.0 = 100%)
  offsetX: 0,                    // screen-px, kan negatief
  offsetY: 0,
  dirty: false,                  // markeer voor next-RAF paint
  currentBitmap: ImageBitmap|null,   // whole-page bitmap for current zoom-bucket
  currentTile: ImageBitmap|null,     // visible-region tile (high-zoom only)
  pageType: 'raster' | 'vector' | 'hybrid',
}
```

Cache modules (apart van viewport):

```js
bitmapCache: Map<cacheKey, ImageBitmap>      // LRU 16
tileCache: Map<cacheKey, ImageBitmap>        // LRU 8
```

## Components

### `pdf-viewport.js`

**Behoudt:** viewport singleton, `_render()` loop, `initViewport()`, `destroyViewport()`, `fitToViewport()`, `setZoomAtPoint()`, `zoomStepAtPoint()`, `zoomAtPoint()`, `clearAnchor()`, `markAnchored()`, `addPanVelocity()`, `stopPanMomentum()`.

**Wijzigt:** `_render()` krijgt nieuwe branch voor raster-bitmap drawImage; `_resizeCanvas()` past niet meer de bitmap aan (canvas blijft container-grootte).

**Verdwijnt:** `clampAndCenter()` (al no-op, body weghalen).

### `renderer.js`

**Behoudt:** `renderPage()` (slimmer, thin orchestrator), bitmap cache get/set, `setPage()` integratie.

**Wijzigt:** `renderPage()` wordt: lookup bitmap voor current (page, zoom-bucket) → cache hit? set `viewport.currentBitmap`, `viewport.dirty=true`. Cache miss? Async Rust render → bij arrival cache fill + viewport.dirty. Geen predictive resize, geen canvas-width mutation, geen tile-overlay calls.

**Verdwijnt:**
- `_renderTileOverlay()` (logica integreert in `_render()` loop)
- `_hideTileOverlay()`, `_scheduleTileRerenderOnScroll()`, `wireTileScrollListener()`
- `currentRenderTask?.cancel() + await` (dead code, PDF.js render-task wordt niet meer gezet)
- `pdfCanvas.style.width/height` predictive resize
- `pdfCanvas.width/height` mutation in render path
- `pauseThumbnails/resumeThumbnails` (alleen behouden als measurement aantoont dat het nodig is)
- `_schedulePreRenderAdjacent` (vervangen door: pre-render alleen ná 1000ms idle, en alleen +1/-1 preset zoom)

### `navigation-events.js`

**Behoudt:** wheel-event listener, ctrl-detect, pinch accumulator, plain-wheel pan delegation.

**Wijzigt:** bitmap-path en vector-path code samengevoegd. Beiden roepen `zoomStepAtPoint(sx, sy, direction)` aan. Geen scroll-anchor math meer (niet nodig — `_anchorAt` doet het in viewport-coordinaten).

**Verdwijnt:** bitmap-legacy block (regel 76-128) — de hele "fractionX, await zoomIn, post-await scroll adjustment" sequentie.

### `index.html`

**Verdwijnt:** `<canvas id="pdf-canvas-tile">` element.

### `layout.css`

**Verdwijnt:** `#pdf-canvas-tile` styles, tile-related rules.

**Behoudt:** `align-items: flex-start; justify-content: flex-start` op `.main-view > #pdf-container.visible` (al v1.49.0).

### `pdf/loader.js` en `pdf/saver.js`

**Geen wijziging.** PDF.js voor metadata + text spans + form fields, pdf-lib voor save. Buiten scope van dit spec.

### Rust backend

**Geen wijziging.** `render_pdf_page` en `render_pdf_page_region` blijven; JS roept ze alleen anders aan.

## Data Flow — Zoom Voorbeeld

User doet ctrl+wheel up bij cursor (920, 412) op BARN p.2 vanaf zoom 2.0:

1. `WheelEvent { ctrlKey: true, clientX: 920, clientY: 412, deltaY: -120 }` arriveert op `.main-view`.
2. `navigation-events.js`: `zoomStepAtPoint(920, 412, +1)`. Sync.
3. In `pdf-viewport.js`: `nextZoomStep(2.0, +1)` → 2.5. `_anchorAt(920, 412, 2.0, 2.5, strict=true)`:
   - `wx = (920 - viewport.offsetX) / 2.0`
   - `wy = (412 - viewport.offsetY) / 2.0`
   - `viewport.offsetX = 920 - wx * 2.5`
   - `viewport.offsetY = 412 - wy * 2.5`
   - `viewport.zoom = 2.5`
   - `viewport.dirty = true`
4. Volgende RAF (≤16ms): `_render()` triggert.
   - Lookup bitmap voor `(BARN, p=2, zoom-bucket=2.5, rot=0)` in cache. Hit of miss?
5. Pad A — Cache HIT: `viewport.currentBitmap` is gezet. `_render()` doet `drawImage(currentBitmap)` op nieuwe `(offsetX, offsetY, pageW*2.5, pageH*2.5)`. Frame klaar in <16ms. User ziet crisp 2.5x bitmap met cursor-anker behouden.
6. Pad B — Cache MISS: `currentBitmap` is van oude zoom-bucket (2.0). `_render()` tekent met OLD bitmap op NEW transform — browser bilinear upscale van 2.0-bitmap naar 2.5-grootte. Blurry maar correcte page-content op juiste positie. Geen flits.
7. Tegelijk in pad B: `renderer.js` ziet cache-miss, kickt `invoke('render_pdf_page', { scale: 2.5 })` af. 500-2000ms later: bitmap arriveert → `createImageBitmap` → store in cache → `viewport.currentBitmap = newBitmap; viewport.dirty = true`. Next RAF: crisp paint.
8. Als zoom 2.5 > capZoom (4096/1632 ≈ 2.51 — geval 2.5 is NET onder cap): geen tile nodig. Whole-page bitmap is voldoende.
9. Als zoom verder zou gaan (bv. naar 3.0 = boven cap): aanvullend `invoke('render_pdf_page_region', { ..., scale: 3.0, region: viewport-visible })` voor tile. Tile arriveert → cache → `viewport.currentTile`. Next RAF: `_render()` tekent whole-bitmap (blurry stretched naar 3.0-grootte) + tile (crisp viewport region).

Gedurende geen enkele stap wordt het canvas-element resized of de canvas-pixels gecleared. De transform verandert; pixels worden over-tekend per frame.

## Migration Path

Eén PR (niet phased), geupdate op `feat/fast-open-barn` branch.

1. **Rip oude bitmap-pad uit `renderer.js`**: verwijder de bitmap-path code (regel ~611-833), `_renderTileOverlay`, `_hideTileOverlay`, etc. Houd `renderPage()` als skeleton.
2. **Refactor `renderPage()` tot thin orchestrator**: alleen cache-lookup + async fill + `viewport.dirty`.
3. **Update `pdf-viewport.js _render()`**: nieuwe branch voor raster-bitmap drawImage met srcRect/destRect berekening; tile-augment branch.
4. **Drop tile DOM canvas**: verwijder `<canvas id="pdf-canvas-tile">` uit HTML, bijbehorende CSS, en alle JS-referenties.
5. **Unify `navigation-events.js` wheel-handler**: bitmap-legacy block weg; één pad via `zoomStepAtPoke`.
6. **Tekst-layer eenmalige creation**: in `setPage()` creëer text-layer op scale=1 en zet `--total-scale-factor: 1`. Verwijder text-layer re-creation in `renderPage()`.
7. **Annotation canvas fixed-size**: sized to container; `setTransform` per frame in render hook.
8. **Verifieer via MCP harness**: draai `zoom-loop.mjs` op BARN p.2. `app_zoom_anchor_test` moet `anchorErrorPx < 3` rapporteren in alle 7 cursor-posities op 3 zoom-niveaus.
9. **Commit + push** voor user-test.

## Out of Scope

- **Continuous (multi-page) view**. Werkt vandaag via `renderContinuous()`. Blijft op huidige path tot v2 spec.
- **Thumbnails panel**. Aparte render-path. Geen wijziging.
- **PDF.js text layer en form fields**. Behoudt huidige creation; alleen positioning via CSS transform aangepast.
- **Touch-event handling op mobile**. Plain wheel + mouse drag genoeg voor desktop. Mobile spec apart.
- **Annotation tools (draw, etc.)**. Tekening van annotations gebruikt PDF-coords en is transform-agnostisch — geen wijziging verwacht maar verifieer in test.
- **Bitmap-pyramid (multi-resolution caching)**. Eén bitmap per zoom-bucket, niet meerdere resoluties tegelijk. Voldoende voor v1.

## Risks

| Risico | Mitigatie |
|--------|-----------|
| Continuous view breekt door state-model verandering | Continuous-pad ongewijzigd laten (gebruikt huidige `renderContinuous()` met eigen canvas, NIET viewport singleton). Detecteer mode in `setPage()` en route ernaar. |
| Tekst-selectie loopt uit sync bij zoom | Test-case: select text, zoom, verifieer selectie blijft op zelfde glyphs. CSS-transform op text-layer doet dit correct als spans op scale-1 staan. |
| Annotation drag/draw raakt sync kwijt | Annotation events gebruiken al PDF-coord → screen-coord conversie via `pdfCoordsFromEvent()`. Verifieer dat deze functie viewport.offsetX/Y/zoom leest (niet doc.scale alleen). |
| Performance dip bij snelle pan over groot capped-bitmap | drawImage moet 60 FPS halen. Test: BARN op zoom 8x met 1700-px viewport, snelle pan. Browser bilinear is GPU-accelerated, zou geen probleem mogen zijn. |
| Touch pinch op laptops met touchscreen | Bestaande accumulator-logica blijft. Verifieer geen regressie. |
| Cursor anchor faalt op de transitie zoom-bucket-wissel | bij zoom-bucket wissel: oude bitmap is van vorige bucket. drawImage tekent op NIEUWE transform. Cursor-anker is correct in WORLD coords, dus de wereldpunt-onder-cursor formule blijft kloppen. |

## Testing

### Unit-niveau (toekomst, niet v1)

Geen unit tests voor render-loop (CSS/DOM-afhankelijk). Voor `_anchorAt` formule pure-functie test mogelijk.

### Integration via MCP harness

Bestaand: `mcp-server/zoom-loop.mjs`. Vereiste `app_zoom_anchor_test` resultaten:

```
Phase 1 (reset zoom, 7 posities, één wheel-tick):
  alle posities → anchorErrorPx < 3

Phase 2 (5x rapid wheel vanuit center):
  alle 5 stappen → anchorErrorPx < 3
  geen STALE gen errors in console

Phase 3 (eindstand phase 2, 7 posities):
  alle posities → anchorErrorPx < 3
  tile rendert correct waar zoom > cap
```

### Visuele verificatie

- Open BARN, langzaam zoom van 100% naar 600%. Geen flits, geen sprong.
- Open Combinatie Raster+Vector+Tekening.pdf, zelfde zoom range. Geen verschil in gedrag.
- Pan ver voorbij page-rand. Page kan grijze ruimte intrekken. F-toets resetten.
- Open BARN, navigeer p.1 → p.2 → p.3 → p.2. Geen ghosting van vorige pagina.

## Success Criteria

1. ✅ `anchorErrorPx < 3` voor alle MCP-test cursor-posities op alle zoom-niveaus.
2. ✅ Geen flits-frames bij langzame zoom 100%→600% op BARN.
3. ✅ User kan voorbij page-randen pannen (verifieer met BARN op 200% zoom).
4. ✅ Vector PDFs (Combinatie) gedragen zich identiek aan raster.
5. ✅ Geen regressie in tekst-selectie, annotation-drag, page-navigatie.
6. ✅ `renderer.js` is met ≥ 30% afgenomen in line-count.

---

## Self-Review Notes

- **Placeholder check**: geen TODO/TBD overgebleven.
- **Scope check**: focus op zoom/pan/render; continuous view, mobile, thumbnails expliciet out-of-scope.
- **Ambiguity check**: zoom-bucket definitie expliciet als "preset zoom levels"; tile buffer expliciet 25%.
- **Internal consistency**: rust commands ongewijzigd; alleen JS-side refactor. State live in viewport singleton.
