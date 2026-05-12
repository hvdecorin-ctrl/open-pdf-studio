# PoC 06 implementatieplan

## Vooraf

- Branch: `poc/06-highres-tier-on-demand` vanaf main HEAD (niet vanaf poc/04 branch)
- Eerst baseline meten: zie `pocs/shared/measure-baseline.mjs`
- Lees `open-pdf-studio/js/pdf/renderer.js` L40–175 voor de bestaande JS-cache en `_schedulePreRenderAdjacent`
- Lees `open-pdf-studio/js/pdf/renderer.js` L455–590 voor de volledige render-flow van de bitmap path

## Pre-requisites

| PoC | Status vereist | Reden |
|-----|---------------|-------|
| PoC 04 bitmap-pyramid-prerender | GO (aanbevolen) | Zonder PoC 04 is de Base tier mogelijk niet gecached bij eerste zoom-in; PoC 06 degradeert graceful maar zonder placeholder-effect |

## Stappen

- [ ] Stap 1: Baseline meten op zoom_1x_to_1_5x first-frame-time + cold_open_p1
  Bestand: n.v.t. (bench run + handmatige meting met DevTools Performance tab)
  Verwacht resultaat: zoom first-frame-time barn ≈ 670 ms (freeze tot Rust klaar is); cold_open_p1 barn ≈ 670 ms

- [ ] Stap 2: Schrijf de `pickTier(filePath, pageNum, currentScale, rotation)` hulpfunctie
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (nieuw, vóór de `renderPage` functie op L292)
  Actie: schrijf een functie die de JS-side bitmap cache doorzoekt op de dichtstbijzijnde lagere schaal die gecached is voor deze (filePath, pageNum, rotation)-combinatie:
  ```js
  function pickLowerTier(filePath, pageNum, currentScale, rotation) {
      // Doorzoek _PRESET_ZOOMS van hoog naar laag (onder currentScale)
      // Retourneer { scale, bitmap } als gevonden, anders null
  }
  ```
  Verwacht resultaat: bij Base tier (1.0×) in cache en currentScale = 1.5 retourneert de functie de Base bitmap; bij lege cache retourneert `null`

- [ ] Stap 3: Voeg de placeholder-logica toe aan het begin van de bitmap render-flow
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (in `renderPage`, vóór de `_jsCacheKey` lookup op L474)
  Actie: voeg in na L464 (na de predictive CSS resize):
  ```js
  // PoC 06: toon lagere tier als CSS-placeholder terwijl HighRes render loopt
  const _lowerTier = pickLowerTier(doc.filePath, pageNum, scale, getPageRotation(pageNum) || 0);
  if (_lowerTier && !_jsCached) {
      // Schaal de lagere tier via CSS transform zodat hij de target-grootte vult
      const _cssScale = scale / _lowerTier.scale;
      pdfCanvas.width = _lowerTier.bitmap.width;
      pdfCanvas.height = _lowerTier.bitmap.height;
      pdfCanvas.getContext('2d').drawImage(_lowerTier.bitmap, 0, 0);
      pdfCanvas.style.transformOrigin = 'top left';
      pdfCanvas.style.transform = `scale(${_cssScale})`;
      pdfCanvas.style.width = Math.floor(viewport.width) + 'px';
      pdfCanvas.style.height = Math.floor(viewport.height) + 'px';
      // Annuleer de CSS-transform zodra de Rust-bitmap arriveert (zie stap 4)
  }
  ```
  Verwacht resultaat: bij zoom 1.0 → 1.5 is de Base bitmap zichtbaar in <50 ms (geen freeze); canvas is blurry maar correct gepositioneerd

- [ ] Stap 4: Annuleer de CSS transform na succesvolle Rust-render
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (in de Rust-render success-handler, na L569)
  Actie: voeg toe na de `pdfCanvas.getContext('2d').drawImage(...)` call:
  ```js
  // Reset de CSS transform nu de scherpe bitmap er is
  pdfCanvas.style.transform = '';
  pdfCanvas.style.transformOrigin = '';
  ```
  Verwacht resultaat: na de Rust-render verdwijnt de blur; geen visuele glitch bij de overgang

- [ ] Stap 5: Verifieer de `transform-origin` op BARN (24"×18" aspect ratio)
  Bestand: n.v.t. (visuele check in de app)
  Actie: open BARN, zoom van 1.0 naar 1.5; controleer dat de pagina niet verschuift tijdens de placeholder-fase
  Verwacht resultaat: de pagina blijft op zijn plek; geen jump bij de Rust-bitmap-swap

- [ ] Stap 6: Beperk de HighRes cache-entries tot actieve page ± 1
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (in de `_bitmapJSCacheSet` aanroep voor HighRes renders)
  Actie: voeg een tag `isHighRes: true` toe aan de cache-entry metadata; pas de evictie-volgorde aan zodat HighRes entries voor niet-actieve pages eerder verdrongen worden dan Base entries
  Verwacht resultaat: maximaal 3 HighRes entries tegelijk in de JS cache; memory ≤ 360 MB voor BARN

- [ ] Stap 7: Annuleer de `_schedulePreRenderAdjacent` voor de schaal die PoC 06 al rendert
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (in `_schedulePreRenderAdjacent` L144)
  Actie: check of de target (page, scale) al een lopende PoC-06-render heeft; skip de pre-render in dat geval
  Verwacht resultaat: geen dubbele Rust-render voor dezelfde (page, scale) combinatie

- [ ] Stap 8: Post-implementatie meting — meet first-frame-time van zoom 1.0 → 1.5 op barn
  Actie: gebruik DevTools Performance tab of `performance.now()` rond de `drawImage` call in stap 3
  Verwacht resultaat: first-frame-time ≤ 50 ms; HighRes arrival ≤ 800 ms

## Meet-protocol

```bash
# Voor (baseline)
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture barn --scenario zoom_1x_to_1_5x_first_frame
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1

# Na (post-implementatie)
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture barn --scenario zoom_1x_to_1_5x_first_frame
node pocs/shared/bench-harness.mjs --fixture barn --scenario zoom_1x_to_1_5x_highres_arrival
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture nkd1a --scenario zoom_1x_to_1_5x_first_frame
```

Noot: `zoom_1x_to_1_5x_first_frame` en `zoom_1x_to_1_5x_highres_arrival` zijn nieuwe bench-scenarios die toegevoegd moeten worden aan `pocs/shared/bench-harness.mjs`. Maak ze aan als onderdeel van deze PoC.

## Resultaten-template

Vul in als `results.md` in deze folder:

| Fixture | Scenario | Voor (ms) | Na (ms) | Delta (ms) | Delta % |
|---------|----------|-----------|---------|------------|---------|
| barn | cold_open_p1 | | | | |
| barn | zoom_1x_to_1_5x first-frame | | | | |
| barn | zoom_1x_to_1_5x HighRes arrival | | n.v.t. | n.v.t. | n.v.t. |
| tekst | cold_open_p1 | | | | |
| nkd1a | zoom_1x_to_1_5x first-frame | | | | |

**CSS transform-origin correct op BARN:** [ ] Ja, geen page-jump  [ ] Nee, glitch gevonden

**Max HighRes cache-entries tegelijk:** ___

**Blur-duur (tijd tussen placeholder en HighRes arrival):** ___ ms

**Succescriterium:** zoom_1x_to_1_5x first-frame barn Na ≤ 50 ms EN cold_open_p1 barn ongewijzigd (± 5%)

**Go/no-go beslissing:** [ ] GO  [ ] NO-GO

**Toelichting:**
