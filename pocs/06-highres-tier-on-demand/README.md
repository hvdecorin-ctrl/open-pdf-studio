# PoC 06 — highres-tier-on-demand

## Hypothese

Bij de eerste zoom voorbij de Base tier (schaal > 1.0 × DPR), toont de JS-kant onmiddellijk de Base bitmap via CSS-upscale terwijl een achtergrond-render naar HighRes tier (2.0×) start; de gebruiker ervaart zoom als instant (geen freeze) en ziet de scherpe versie zodra de Rust-render klaar is (~670 ms later), in plaats van een freeze van ~670 ms vóór de pagina überhaupt groot wordt.

## Rationale

Het probleem is volgorde: de huidige code in `open-pdf-studio/js/pdf/renderer.js` L458–464 doet al een "predictive CSS resize" — de canvas wordt via `pdfCanvas.style.width/height` op de nieuwe grootte gezet vóór de Rust-render begint. Maar de bitmap zelf is nog de Base-schaal-bitmap; de CSS strekt die uit (blurry). Dan wacht de code op de Rust-render (L527–565) die 670 ms kost. Pas daarna verschijnt de scherpe 1.5× bitmap.

PoC 06 formaliseert en versterkt dit patroon door er een expliciete tier-structuur van te maken:

- **Preview tier:** 0.5× — voor thumbnails (buiten scope van deze PoC)
- **Base tier:** 1.0× — gevuld door PoC 04 eager prerender bij document-open
- **HighRes tier:** 2.0× — lazily gevuld bij eerste zoom-in boven 1.0×

De sleutel-inzicht: de JS-side bitmap cache in `renderer.js` L40–76 en de Rust-side `PageBitmapCache` in `parser.rs` L24–77 slaan exact hetzelfde op, maar op verschillende schalen. Als de Base tier (scale 1.0) al gecached is na PoC 04, kan de JS-kant bij zoom naar 1.5× de Base bitmap direct weergeven via CSS `transform: scale(1.5)` — geen Rust-render nodig voor de first frame. Rust rendert ondertussen op scale 1.5 (of 2.0 als HighRes tier) en vervangt de uitgerekte bitmap zodra klaar.

Dit verschilt van de huidige situatie: nu wordt bij zoom naar 1.5× de `_BITMAP_JS_CACHE` gecheckt op de key `|1.5000|` — een miss. Dan start de Rust-render. Dan wacht de code. Met PoC 06 is de redenering: "cache-miss op scale 1.5 → pak de dichtstbijzijnde lagere schaal uit de cache (scale 1.0) → toon dat als CSS-upscale → start Rust-render asynchroon".

De `_schedulePreRenderAdjacent` functie in `renderer.js` L144–175 doet al iets vergelijkbaars: hij pre-rendert de ±1 zoom-stap als achtergrond-werk. PoC 06 voegt de "onmiddellijk tonen van lagere tier als placeholder" toe aan de foreground render-flow, zodat de gebruiker nooit een blank canvas ziet.

De JS-kant heeft de `_PRESET_ZOOMS` array (L89–93 in renderer.js) met discrete zoom-niveaus. De `pickTier(scale)` hulpfunctie (nieuw in PoC 06) mapt een willekeurige schaal naar de dichtstbijzijnde lagere tier die gecached is.

Memory-impact: de HighRes tier is 4× zwaarder dan de Base tier (2× in elke dimensie = 4× pixels). Voor BARN p1 op scale 2.0: ~120 MB RGBA. De LRU-cache kan dit niet voor alle 7 pages tegelijk vasthouden (7 × 120 MB = 840 MB, boven het 700 MB budget). Mitigatie: de HighRes tier wordt alleen gecached voor de actieve page + ±1 prefetch — maximaal 3 HighRes entries tegelijk.

## Failure modes

1. **CSS-upscale van Base bitmap is te blurry bij grote zoom.** Bij zoom-factor 2.0× is de Base bitmap 2× uitgerekt via CSS. Op een Retina-scherm (DPR 2) is dit nog acceptabel; op een 1× scherm ziet elke pixel 2× 2 schermPixels en zijn de letterranden zichtbaar blurry. De wachttijd tot de HighRes bitmap klaar is bepaalt hoe lang de gebruiker de blur ziet. Als de Rust-render 670 ms duurt, ziet de gebruiker 670 ms blur. Dit is beter dan 670 ms freeze, maar niet ideaal. Mitigatie: start de HighRes render bij de eerste detectie van zoom-intentie (mousewheel-event, vóór de schaal aangepast wordt) zodat de blur-tijd kleiner is.

2. **PoC 04 is niet actief: Base tier niet in cache bij zoom.** Als PoC 04 niet is geactiveerd en de gebruiker zoomt in voordat de Base tier gecached is (eerste page render nog bezig of cache miss), is er geen lagere tier beschikbaar als placeholder. De `pickTier` functie moet dit afhandelen door `null` terug te geven als er geen lagere cached tier is, en dan de normale render-flow te volgen (geen placeholder, wel freeze). Dit is het correcte graceful-degradation gedrag.

3. **Schaal-interpolatie: CSS transform vs canvas resize.** De huidige code zet `pdfCanvas.style.width/height` (CSS resize). Een CSS `transform: scale(factor)` is iets anders en vereist ook aanpassing van `transform-origin`. Als de pagina in een scrollbare container zit, kan een verkeerde `transform-origin` de pagina verschuiven. Verificeer het CSS-gedrag op BARN (die 24"×18" page met specifieke aspect ratio) vóór je de tier-swap-animatie implementeert.

4. **HighRes tier slaat naast de JS-cache LRU.** De JS-side bitmap cache in `renderer.js` L40–41 heeft capaciteit 16. Als de gebruiker snel door 16 zoom-levels navigeert (bijv. via het zoom-dropdown), kan de HighRes bitmap voor de huidige page al ge-evict zijn vóór de volgende render. Dan start de Rust-render opnieuw. De capaciteit 16 is ontworpen voor "7 pages × 2-3 zoom levels" — bij de HighRes tier erbij wordt dat krap. Overweeg de capaciteit te verhogen naar 24 of de HighRes tier apart te cachen.

5. **Tijdspanne tussen placeholder-toon en HighRes-arrival is inconsistent.** Op een snelle machine (NVMe + 8 cores) duurt de Rust HighRes render ~200 ms; op een trage machine ~1200 ms. De placeholder-animatie (Base CSS-upscale → HighRes swap) ziet er op een trage machine amateuristisch uit als de blur 1.2 s aanhoudt. Dit is geen bug maar een perceptie-risico. Mitigatie: voeg een fade-in toe bij de HighRes-swap (opacity 0 → 1 over 200 ms) zodat de overgang zachter aanvoelt.

6. **Interactie met `_schedulePreRenderAdjacent`.** Die functie (renderer.js L144) pre-rendert al zoom ±1 en ±2 stappen. Als PoC 06 de HighRes render start én `_schedulePreRenderAdjacent` ook de HighRes render start, zijn er twee parallelle Rust-renders voor dezelfde (page, scale) combinatie. De Rust-side pixmap cache maakt dit harmless (tweede render vindt een cache-hit), maar het verspilt CPU. Mitigatie: invalideer de prerender-queue wanneer PoC 06 expliciet een HighRes render start voor die specifieke (page, scale).

## Succescriterium

**Go** als zoom van 1.0× naar 1.5× op fixture `barn` page 1 een first-frame-time van ≤ 50 ms heeft (CSS-placeholder zichtbaar voor de gebruiker) EN de HighRes bitmap arriveert binnen 800 ms (Rust-render klaar).

**No-go** als de CSS-placeholder meer dan 100 ms kost om te tonen (dat is trager dan de huidige freeze), of als er visuele regressies zijn (pagina verschuift bij zoom, verkeerde `transform-origin`).

Controle: het `cold_open_p1` scenario op `barn` mag niet veranderen — PoC 06 raakt alleen de zoom-flow, niet de initiële render.

## Verwachte effort

1 dag. De Rust-kant vereist geen aanpassing (de bestaande `render_pdf_page` command rendert op elke gewenste schaal). De implementatie is volledig JS-kant: `pickTier`, placeholder-logica, en de CSS-transform coördinatie.

## Risico

**Laag.** De Rust-kant is ongewijzigd. De JS-wijziging is additioneel (een extra fast-path vóór de bestaande render-flow, niet een vervanging). Bij elke mislukking valt de code terug op de huidige flow. De enige echte risico's zijn CSS-geometrie (punt 3) en de perceptie van blur-duur (punt 5), beide meetbaar.

## Pre-existing context

- `open-pdf-studio/js/pdf/renderer.js` L40–76 — JS-side bitmap LRU cache (`_BITMAP_JS_CACHE`, capaciteit 16)
- `open-pdf-studio/js/pdf/renderer.js` L78–175 — `_schedulePreRenderAdjacent` en `_PRESET_ZOOMS` array, het bestaande zoom-level systeem
- `open-pdf-studio/js/pdf/renderer.js` L455–465 — bestaande "predictive CSS resize" (de directe voorloper van PoC 06's placeholder-logica)
- `open-pdf-studio/js/pdf/renderer.js` L466–490 — JS-cache hit-pad (drawImage van gecachede bitmap in <10 ms)
- `open-pdf-render/src/parser.rs` L24–77 — Rust-side `PageBitmapCache` met scale-quantized key
- PoC 04 (bitmap-pyramid-prerender) — vereist actief voor maximale effectiviteit: zonder PoC 04 is de Base tier mogelijk niet gecached bij de eerste zoom-in
- `parliament/index.html` — "Laag 2 — Output: per-page bitmap pyramid met Base & HighRes tiers" als onderdeel van de twee-laags architectuurvisie
