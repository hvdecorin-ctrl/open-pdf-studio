# PoC 07 implementatieplan

## Vooraf

- Branch: `poc/07-ui-progressive-feedback` vanaf main HEAD
- Eerst baseline meten: zie `pocs/shared/bench-harness.mjs`
- Lees `open-pdf-studio/js/pdf/renderer.js` L474–590 voor de bestaande bitmap render-flow
- Lees `open-pdf-studio/js/ui/panels/left-panel.js` L279–298 en L559–578 voor de bestaande thumbnail-flow

## Pre-requisites

| PoC | Status vereist | Reden |
|-----|---------------|-------|
| Geen | n.v.t. | PoC 07 is volledig onafhankelijk van de Rust-PoCs; werkt ook zonder PoC 01-06 actief |

## Stappen

- [ ] Stap 1: Baseline meten op cold_open_p1 + scroll_p1_to_p7
  Bestand: n.v.t. (bench run)
  Verwacht resultaat: cold_open_p1 barn ≈ 670 ms; scroll_p1_to_p7 barn ≈ 1200 ms

- [ ] Stap 2: Voeg feature-flag toe bovenin renderer.js
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (na de bestaande `FEATURE_TILE_RENDERING` flag op L28)
  Actie: voeg toe:
  ```js
  // PoC 07: visuele placeholder tijdens render. Zet op true om te testen.
  const FEATURE_PROGRESSIVE_FEEDBACK = false;
  ```
  Verwacht resultaat: flag beschikbaar voor conditionele checks verderop

- [ ] Stap 3: Maak de skeleton-placeholder helper functie
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (nieuw blok vóór de `renderPage` functie op L292)
  Actie: schrijf twee functies:
  ```js
  function _showSkeleton(container, widthPx, heightPx) {
      // Maakt een absolute-gepositioneerde div met shimmer-animatie aan
      // width/height gelijk aan canvas-container afmetingen
  }
  function _hideSkeleton(container) {
      // Verwijdert de skeleton-div (of zet display: none)
  }
  ```
  Verwacht resultaat: bij aanroep met correcte container is een grijze geanimeerde overlay zichtbaar bovenop het canvas

- [ ] Stap 4: Schrijf de CSS voor de shimmer-animatie
  Bestand: het relevante CSS-bestand voor de canvas-container (verifieer locatie via `grep -rn "canvas-container" open-pdf-studio/`)
  Actie: voeg toe:
  ```css
  .pdf-skeleton {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, #e8e8e8 25%, #f5f5f5 50%, #e8e8e8 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.2s infinite linear;
    pointer-events: none;
    z-index: 1;
  }
  @keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  ```
  Verwacht resultaat: shimmer beweegt vloeiend; animatie stopt niet zodra het scherm even druk bezet is

- [ ] Stap 5: Inject skeleton-logica in de renderPage bitmap-flow
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (direct na de viewport-berekening, vóór de `_jsCacheKey` lookup op L474)
  Actie: voeg toe:
  ```js
  if (FEATURE_PROGRESSIVE_FEEDBACK) {
      const _container = pdfCanvas.parentElement;
      if (_container) _showSkeleton(_container, viewport.width, viewport.height);
  }
  ```
  En aan het einde van de bitmap-render success-handler (na `drawImage`, voor `_bitmapJSCacheSet`):
  ```js
  if (FEATURE_PROGRESSIVE_FEEDBACK) {
      const _container = pdfCanvas.parentElement;
      if (_container) _hideSkeleton(_container);
  }
  ```
  Verwacht resultaat: skeleton verschijnt bij cache-miss, verdwijnt zodra bitmap klaar is

- [ ] Stap 6: Implementeer low-res preview via render_thumbnail (Techniek 2)
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (zelfde injectie-punt als stap 5, direct na skeleton-tonen)
  Actie: voeg toe na de skeleton-toon-aanroep:
  ```js
  if (FEATURE_PROGRESSIVE_FEEDBACK && window.__TAURI__) {
      // Fire-and-forget: haal thumbnail op en zet als achtergrond-img op container
      // Gebruik queueMicrotask zodat de Rust-backend niet geblokkeerd wordt
      // vóór de hoofd-render start
      queueMicrotask(async () => {
          try {
              const { invoke } = window.__TAURI__.core;
              const thumbResult = await invoke('render_thumbnail', {
                  path: doc.filePath,
                  pageIndex: pageNum - 1,
                  maxWidth: 200,
                  skipImages: true,
              });
              const thumbData = JSON.parse(thumbResult);
              // Toon als gestretcht img bovenop skeleton maar onder hi-res bitmap
              // ... (zie stap 7)
          } catch (_) { /* stil falen — skeleton blijft staan */ }
      });
  }
  ```
  Verwacht resultaat: thumbnail verschijnt binnen 10–50 ms na skeleton; vervangt de lege shimmer-state met echte (zij het lage-resolutie) content

- [ ] Stap 7: Stretch thumbnail naar volledige canvas-grootte
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (verlenging van de thumbnail-handler uit stap 6)
  Actie: maak een `<img>` element met `src = thumbData.dataURL`, stijl `position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; z-index: 2;` en voeg toe aan dezelfde container als de skeleton
  Noot: `object-fit: fill` forceert stretch inclusief vervorming — acceptabel voor een preview-state
  Verwacht resultaat: low-res preview is zichtbaar als placeholder voor de hi-res bitmap

- [ ] Stap 8: Implementeer fade-in van de hi-res bitmap (Techniek 3)
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (in de success-handler van de Rust-render, vlak vóór `drawImage`)
  Actie: voeg een CSS `opacity: 0` + transitie van 200 ms toe aan het canvas element vóór het nieuwe bitmap-frame, zet `opacity: 1` na de `drawImage` aanroep
  Verwacht resultaat: de overgang van low-res preview naar hi-res bitmap is vloeiend; geen harde swap-flash

- [ ] Stap 9: Cleanup — verwijder thumbnail-img en skeleton na bitmap-swap
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (verlenging van stap 8, na de opacity-transitie)
  Actie: roep `_hideSkeleton(container)` aan en verwijder de thumbnail `<img>` uit de DOM
  Verwacht resultaat: na de hi-res render is de DOM schoon; geen orphan elements

- [ ] Stap 10: Verifieer dat pauseThumbnails niet langer gepauzeerd blijft
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (check de bestaande `resumeThumbnails()` aanroepen op L440 en L444)
  Actie: bevestig dat de PoC 07 thumbnail-aanroep (stap 6) niet interfereert met het `_thumbnailsPaused` mechanisme uit `left-panel.js` L276
  Verwacht resultaat: na de page-render wordt `resumeThumbnails()` nog steeds aangeroepen op het normale punt; thumbnail-strip laadt normaal

- [ ] Stap 11: A/B test setup — feature-flag op true zetten, 5 test-sessies
  Actie: zet `FEATURE_PROGRESSIVE_FEEDBACK = true` in de lokale build; voer de standaard BARN-workflow uit (open, page 1 bekijken, sluiten) met 5 personen of 5 afzonderlijke sessies; noteer subjectieve beoordeling ("acceptabel"/"te langzaam")
  Verwacht resultaat: alle 5 sessies beoordelen wachttijd als "acceptabel"

- [ ] Stap 12: Post-implementatie bench meting
  Bestand: n.v.t. (bench run)
  Verwacht resultaat: cold_open_p1 barn stijgt niet meer dan 5%; scroll_p1_to_p7 barn stijgt niet meer dan 5%

## Meet-protocol

```bash
# Voor (baseline — met feature flag UIT)
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture nkd1a --scenario cold_open_p1

# Na (post-implementatie — met feature flag AAN)
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture nkd1a --scenario cold_open_p1
```

Noot: de A/B perceptie-test is niet automatiseerbaar via de bench-harness. Voer deze handmatig uit en documenteer de bevindingen in het resultaten-template hieronder.

Subjectief meten van eerste-visuele-feedback:
- Open DevTools Performance tab, start recording
- Open BARN fixture
- Stop recording, zoek het moment van eerste non-blank pixel op de canvas-container
- Noteer tijdstip relatief aan start van `renderPage()` aanroep (zichtbaar als console log `[PERF] renderPage`)

## Resultaten-template

Vul in als `results.md` in deze folder:

| Fixture | Scenario | Voor (ms) | Na (ms) | Delta (ms) | Delta % |
|---------|----------|-----------|---------|------------|---------|
| barn | cold_open_p1 | | | | |
| barn | scroll_p1_to_p7 | | | | |
| tekst | cold_open_p1 | | | | |
| nkd1a | cold_open_p1 | | | | |

**Eerste visuele feedback (skeleton zichtbaar) op barn:** ___ ms na renderPage() aanroep

**Low-res preview beschikbaar op barn:** ___ ms na renderPage() aanroep

**Subjectieve A/B beoordeling (feature flag AAN):**
- Sessie 1: [ ] acceptabel  [ ] te langzaam
- Sessie 2: [ ] acceptabel  [ ] te langzaam
- Sessie 3: [ ] acceptabel  [ ] te langzaam
- Sessie 4: [ ] acceptabel  [ ] te langzaam
- Sessie 5: [ ] acceptabel  [ ] te langzaam

**Thumbnail-strip na page-render nog steeds actief:** [ ] Ja  [ ] Nee

**Succescriterium:** cold_open_p1 stijgt ≤ 5% EN ≥ 4/5 test-sessies beoordelen als "acceptabel"

**Go/no-go beslissing:** [ ] GO  [ ] NO-GO

**Toelichting:**
