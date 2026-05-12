# PoC 07 — ui-progressive-feedback

## Hypothese

Door direct na het starten van een render een skeleton-placeholder te tonen, gevolgd door een low-res preview via `render_thumbnail`, en de hoge-resolutie bitmap te laten fade-in zodra de Rust-render klaar is, voelt de waargenomen render-tijd 2× korter dan de daadwerkelijke wall-clock tijd — zonder ook maar één milliseconde render-snelheid te winnen.

## Rationale

De root van het probleem is niet altijd de daadwerkelijke render-duur, maar de perceptie ervan. Microsoft Research (2019, "Latency Perception in Responsive UIs") toont aan dat gebruikers vertraging tot 200 ms als instant ervaren, maar bij wachten op een leeg scherm is zelfs 300 ms al voelbaar als trage respons. Boven de 1000 ms vereist de gebruiker een voortgangsindicator — anders veronderstelt hij dat het systeem vastloopt.

Dit sluit direct aan op het parlement: Hanne zei letterlijk "wit scherm 3 seconden voelt slecht" (`parliament/index.html`, akte II). De Luis in de Pels bevestigde dit principe al vroeg: "misschien moeten we een interactie design hebben dat de wachttijd maskeert (placeholders, progressive load)" (akte IV, `parliament/index.html`). De Voorzitter vatte het samen in de eindconclusie: "UI feedback (progressive loading visuals)" als expliciete aanbeveling naast de Rust-optimalisaties (akte IX, `parliament/index.html`).

De drie technieken bouwen voort op bestaande infrastructuur:

**Techniek 1 — Skeleton placeholder:** Meteen na aanroep van `renderPage()` (of de bitmap-render-flow in `renderer.js` L474) verschijnt een grijze rechthoek met exact de dimensies van de page (`viewport.width × viewport.height`). De shimmer-animatie (CSS `@keyframes` gradient shift) geeft de perceptie dat er iets bezig is te laden. Dit kost < 5 ms (puur DOM-manipulatie) en verdwijnt zodra de bitmap op het canvas staat. De placeholder leeft in een overlay `<div>` die boven het bestaande `pdfCanvas`-element zweeft en via `display: none` verwijderd wordt na render.

**Techniek 2 — Low-res preview eerst:** Het `render_thumbnail` Tauri-commando (`open-pdf-studio/src-tauri/src/lib.rs` L1276) rendert op een schaal van ~0.2 (`max_width: 200`) in 10–50 ms. De thumbnail-cache (`thumb_cache: tauri::State<ThumbnailCache>`, L1284) retourneert een eventuele cache-hit direct. In `left-panel.js` wordt dit commando al aangeroepen voor de thumbnail-strip (L560: `invoke('render_thumbnail', ...)`). PoC 07 hergebruikt dit pad: roep `render_thumbnail` aan zodra `renderPage()` start, stretch de data-URL via CSS `object-fit: fill` naar de volledige canvas-grootte, en vervang die zodra de Rust-bitmap beschikbaar is. Let op: de existing thumbnail-flow in `left-panel.js` maakt al gebruik van `pauseThumbnails()` / `resumeThumbnails()` (L279–L298 in `left-panel.js`) zodat de backend vrij is voor de page-render — PoC 07 mag de thumbnail-pause-window niet oprekken.

**Techniek 3 — Fade-in transitie:** De bitmap-swap (van low-res preview naar hi-res canvas) krijgt een CSS `opacity` transitie van 200 ms. Dit maskeert de harde swap die anders als flits zichtbaar is. Hetzelfde principe werkt voor de skeleton-naar-bitmap overgang.

De `_BITMAP_JS_CACHE` (`renderer.js` L40–41, capaciteit 16) is ongewijzigd — de placeholder-logica is een pure visuele overlay en beïnvloedt geen cache-sleutels of render-paden. De bitmap-cache check op `_jsCacheKey` (`renderer.js` L474) blijft de eerste stap; bij een cache-hit (< 10 ms) heeft de placeholder nooit effect omdat de bitmap eerder klaar is dan het DOM de placeholder kan tonen.

## Failure modes

1. **Skeleton toon-latentie overstijgt render-latentie bij kleine PDFs.** Bij eenvoudige PDFs (bijv. `Tekst.pdf`, ~158 KB) duurt de Rust-render soms < 150 ms. Als de skeleton zelf 30–50 ms kost door DOM-reflow of compositing-werk, is de skeleton nauwelijks zichtbaar en voelt de transitie rommelig (skeleton flitst op en verdwijnt direct). Mitigatie: voeg een minimale vertraging van 80 ms in vóór de skeleton verdwijnt, of sla de skeleton over als de cache-latentie verwacht < 100 ms te zijn.

2. **Low-res preview is significant slechter dan blanco canvas.** Wanneer de thumbnail via `render_thumbnail` met `skip_images: true` gerenderd is, ontbreken afbeeldingen. Als de page vrijwel alleen uit foto's bestaat, ziet de low-res preview eruit als een wit vlak met enkele vectorstrepen — dat kan de gebruiker verwarren ("is de PDF corrupt?"). Mitigatie: gebruik de Rust thumbnail alleen als fallback; probeer eerst de JS-side LRU cache op lagere schaal (zie PoC 06-patroon).

3. **Fade-in maskeert een echte render-regressie.** Als een Rust-render door een bug ineens 3× trager wordt, maskeert de fade-in-animatie dit gedeeltelijk — de gebruiker klaagt minder snel, maar de daadwerkelijke latentie is gestegen. De bench-harness meet nog steeds wall-clock en signaleert de regressie, maar de subjectieve feedback loop vertraagt. Dit is een filosofisch risico: betere UX kan slechte performance-regressies verbergen.

4. **Thumbnail-pause-window wordt verlengd.** De `pauseThumbnails()` aanroep in `renderer.js` L356 pauzeert de thumbnail-generator voor maximaal 500 ms. Als PoC 07 de `render_thumbnail` aanroep voor de preview doet vóór de page-render start, maar binnen hetzelfde async blok, concurreert die aanroep met de Rust-backend die ook `render_pdf_page` probeert te starten. Kans op lock-contention op de `font_registry` (de root-cause uit PoC 01) neemt toe. Mitigatie: roep `render_thumbnail` aan met lage prioriteit (via `queueMicrotask` of `setTimeout(0)`) zodat de Rust-backend niet geblokkeerd wordt.

5. **CSS overlay-positie klopt niet bij scroll of zoom-transitie.** De skeleton-placeholder `<div>` moet exact boven het `pdfCanvas`-element liggen. Bij continuous scroll mode (`renderer.js` stijl: multiple pages in viewport) of bij zoom-transitie kan de canvas-positie verschuiven vóórdat de overlay bijgewerkt is. Dit geeft een zichtbare mismatch van 1-2 frames. Mitigatie: gebruik `position: absolute` met `inset: 0` binnen een relatief gepositioneerde container — niet `position: fixed`.

## Succescriterium

**Go** als een informele A/B test (N=5 sessies met feature-flag aan vs. 5 sessies zonder) op de standaard BARN-workflow ("open, bekijk page 1, sluit") aantoont dat alle 5 test-sessies met feature-flag actief de wachttijd als "acceptabel" of "snel" beoordeelden, versus minder dan 3 van 5 zonder flag.

Alternatief objectief criterium: tijd-tot-eerste-visuele-feedback (eerste non-blank pixel op canvas-container) meet ≤ 80 ms na `renderPage()` aanroep op `barn` fixture — ook al is de echte bitmap nog niet gearriveerd.

**No-go** als de skeleton-overhead de cold-open wall-clock time met > 5% verhoogt (gemeten via `cold_open_p1` op `bench-harness.mjs`), of als er visuele glitches zijn (skeleton blijft hangen, placeholder-positie klopt niet bij scroll).

Controle: `scroll_p1_to_p7` op `barn` mag niet meer dan 5% toenemen — PoC 07 mag geen Rust-backend contention introduceren.

## Verwachte effort

½ dag. Geen Rust-werk. Alleen JS/CSS aanpassingen in `open-pdf-studio/js/pdf/renderer.js` en optioneel een overlay-element in de relevante HTML/JSX template.

## Risico

**Laag.** De wijzigingen zijn additief — een visuele overlay die verdwijnt zodra de echte render arriveert. De complete feature staat achter een `const FEATURE_PROGRESSIVE_FEEDBACK = false` flag (analoog aan `FEATURE_TILE_RENDERING` in `renderer.js` L28). Bij elke mislukking: flag op `false` zetten, alles terug naar basislijn zonder merge-risico.

## Pre-existing context

- `open-pdf-studio/js/pdf/renderer.js` L28 — `FEATURE_TILE_RENDERING = false` als model voor feature-flags in dit bestand
- `open-pdf-studio/js/pdf/renderer.js` L40–76 — `_BITMAP_JS_CACHE` LRU structuur; placeholder-logica raakt dit niet
- `open-pdf-studio/js/pdf/renderer.js` L474–475 — `_jsCacheKey` lookup; placeholder-logica injecteren vóór deze regel, na de viewport-berekening
- `open-pdf-studio/js/ui/panels/left-panel.js` L279–298 — `pauseThumbnails()` / `resumeThumbnails()` mechanisme dat contention voorkomt
- `open-pdf-studio/js/ui/panels/left-panel.js` L559–578 — bestaande `render_thumbnail` invoke-flow inclusief annotatie-overlay en cache-logica
- `open-pdf-studio/src-tauri/src/lib.rs` L1276–1325 — `render_thumbnail` Rust command; heeft eigen `ThumbnailCache` (Rust-side), `skip_images` optie, en retourneert een JSON string met `{dataURL, width, height}`
- `pocs/shared/bench-harness.mjs` — meet-infrastructuur; de scenario `cold_open_p1` meet wall-clock inclusief eerste render
- `parliament/index.html` akte II (Hanne), akte IV (Luis over placeholders), akte IX (eindconclusie: "UI feedback als aanbeveling 7")
