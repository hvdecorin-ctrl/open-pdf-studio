# PoC 08 implementatieplan

## Vooraf

- Branch: `poc/08-preflight-thumbnail-ui` vanaf main HEAD
- Lees `open-pdf-studio/js/pdf/loader.js` L245–270 voor de document-open flow
- Lees `open-pdf-studio/js/ui/panels/left-panel.js` L201–267 voor de bestaande `generateThumbnails()` structuur
- **Voer eerst de kritische meting uit (stap 1) vóór enige implementatie** — als die meting faalt is de hypothese onhaalbaar en stopt de PoC hier

## Pre-requisites

| PoC | Status vereist | Reden |
|-----|---------------|-------|
| Geen | n.v.t. | PoC 08 is onafhankelijk; kan ook gecombineerd worden met PoC 07 (fade-in) als aanvulling |

## Stappen

### Fase 0 — Hypothese-verificatie (do first, no implementation yet)

- [ ] Stap 0: Meet de werkelijke duur van 7× render_thumbnail op barn (koud systeem)
  Bestand: n.v.t. (meting in DevTools Console of via Tauri performance logging)
  Actie: open de app, open de browser-console (F12), voer handmatig uit:
  ```js
  const { invoke } = window.__TAURI__.core;
  const t0 = performance.now();
  for (let i = 0; i < 7; i++) {
    await invoke('render_thumbnail', { path: '<barn-path>', pageIndex: i, maxWidth: 200, skipImages: true });
  }
  console.log('7× thumbnail sequentieel:', performance.now() - t0, 'ms');
  ```
  Verwacht resultaat: < 350 ms (50 ms per thumbnail × 7)
  **Als resultaat > 500 ms: STOP. Hypothese is onhaalbaar. Noteer in results.md als NO-GO en sluit de PoC.**
  Verwacht resultaat bij cache-miss (eerste keer): 210–350 ms totaal

### Fase 1 — Baseline meting

- [ ] Stap 1: Baseline meten op cold_open_p1
  Bestand: n.v.t. (bench run)
  Verwacht resultaat: cold_open_p1 barn ≈ 670 ms

### Fase 2 — Variant keuze

Na stap 0 en stap 1 kies je de te implementeren variant:
- Als je 8+ pages PDFs wil ondersteunen en bereid bent UX-breuk te riskeren: kies **Variant A**
- Als je een veilige, transparante verbetering wil: kies **Variant B**
- Beide varianten mogen in dezelfde PoC getest worden via een tweede feature-flag

### Fase 3 — Gemeenschappelijke infrastructuur (beide varianten)

- [ ] Stap 2: Voeg feature-flags toe in loader.js
  Bestand: `open-pdf-studio/js/pdf/loader.js` (bovenaan het bestand, na de imports)
  Actie: voeg toe:
  ```js
  // PoC 08: preflight thumbnail UI. Zet op 'modal' of 'hybrid' om te testen.
  const FEATURE_PREFLIGHT_UI = false; // false | 'modal' | 'hybrid'
  ```
  Verwacht resultaat: flag beschikbaar voor de document-open flow

- [ ] Stap 3: Verifieer waar in loader.js de normale render + generateThumbnails wordt gestart
  Bestand: `open-pdf-studio/js/pdf/loader.js` L255–268
  Actie: bevestig dat `generateThumbnails()` (L264) en de renderPage aanroep voor page 1 beide op dit punt starten
  Verwacht resultaat: duidelijke injectie-locatie voor de PoC-interceptor

- [ ] Stap 4: Schrijf de `fetchAllThumbnails(doc, count)` helperfunctie
  Bestand: `open-pdf-studio/js/pdf/loader.js` (nieuw blok, of import vanuit left-panel.js als reuse mogelijk is)
  Actie: schrijf een async functie die sequentieel of parallel alle thumbnails ophaalt via `invoke('render_thumbnail', ...)` voor pages 1-N en retourneert als een array van `{dataURL, width, height, pageNum}` objecten
  Noot: gebruik sequentieel aanroepen (niet Promise.all) om Rust-backend lock-contention te vermijden; de Mutex-problematiek uit PoC 01 geldt ook hier
  Verwacht resultaat: na aanroep zijn alle N thumbnails beschikbaar als data-URLs

### Fase 4A — Variant A: Modal page picker

- [ ] Stap 5A: Ontwerp en implementeer de modal HTML/CSS
  Bestand: het relevante SolidJS component of vanilla JS modal (volg het patroon van bestaande modals in `open-pdf-studio/js/ui/`, gebruik Windows-style: squared corners, gradient title bar conform CLAUDE.md)
  Actie: maak een modale overlay (movable, niet-sluitbaar bij klik buiten, conform CLAUDE.md conventie) met:
  - Titel: "Kies een pagina"  
  - Grid van thumbnail-items (3 per rij, maximaal 3 rijen = 9 pages; bij meer pages: scrollable)
  - Knopcaption onder elke thumbnail: "Pagina N"
  - Actieknop rechtsonder: "Ga naar pagina 1 →" (skip picker, direct naar page 1)
  Verwacht resultaat: modal is visueel consistent met de rest van de app; duidelijk onderscheidbaar van een bestandsopener

- [ ] Stap 6A: Koppel de modal aan document-open
  Bestand: `open-pdf-studio/js/pdf/loader.js` (op het punt van stap 3)
  Actie: als `FEATURE_PREFLIGHT_UI === 'modal'` en `pageCount > 2`:
  1. Roep `fetchAllThumbnails()` aan (stap 4)
  2. Toon de modal met de thumbnail-data
  3. Wacht op gebruikerskeuze (`Promise` die resolves met het gekozen paginanummer)
  4. Start de full-res render voor de gekozen page
  5. Sla `generateThumbnails()` voor de thumbnail-strip over (thumbnails zijn al geladen)
  Verwacht resultaat: modal is zichtbaar < 300 ms na file-open; klik start direct de full-res render

- [ ] Stap 7A: Implementeer de "Ga naar pagina 1" skip-knop
  Bestand: modal component (stap 5A)
  Actie: klik op de skip-knop dismisst de modal en start direct de full-res render van page 1 (identiek aan huidige gedrag)
  Verwacht resultaat: geen UX-breuk voor gebruikers die de picker niet willen

- [ ] Stap 8A: Edge case — ≤ 2 pages
  Bestand: `open-pdf-studio/js/pdf/loader.js` (in de modal-trigger logica)
  Actie: als `pageCount <= 2`, sla de modal volledig over en val terug op normale page 1 render
  Verwacht resultaat: 1-page en 2-page PDFs openen direct zoals nu

### Fase 4B — Variant B: Hybrid

- [ ] Stap 5B: Intercepteer de page 1 render — laat die intact
  Bestand: `open-pdf-studio/js/pdf/loader.js` (op het punt van stap 3)
  Actie: als `FEATURE_PREFLIGHT_UI === 'hybrid'`: doe niets aan de page 1 render; die blijft identiek aan de huidige flow
  Verwacht resultaat: open-time voor page 1 is ongewijzigd

- [ ] Stap 6B: Defer de full-res render van pages 2-N tot on-click
  Bestand: `open-pdf-studio/js/ui/panels/left-panel.js` (in de thumbnail-click handler)
  Actie: voeg een check toe die bij thumbnail-click kijkt of de page al full-res gerenderd is; zo niet, start de full-res render voor die page
  Noot: verifieer de bestaande click-handler in `left-panel.js` via grep: `grep -n "thumbnail.*click\|click.*thumbnail\|selectThumbnailPage" open-pdf-studio/js/ui/panels/left-panel.js`
  Verwacht resultaat: klik op thumbnail-item in sidebar triggert full-res render for die page

- [ ] Stap 7B: Verifieer dat thumbnails sneller klaar zijn dan de huidige situatie
  Bestand: n.v.t. (timing-meting in DevTools)
  Actie: meet de tijd van document-open tot thumbnail-strip volledig gevuld voor pages 2-7 op `barn`
  Verwacht resultaat: thumbnail-strip vol binnen 500 ms van document-open (parallel met page 1 render)

### Fase 5 — Gebruikers-test

- [ ] Stap 8: Informele gebruikers-test (Variant A)
  Actie: voer de BARN-workflow uit met 5 testpersonen met de modal actief:
  1. Laat testpersoon het bestand openen (geen uitleg over de modal vooraf)
  2. Observeer: begrijpt de testpersoon de modal? Klikt hij op een thumbnail of op de skip-knop?
  3. Vraag achteraf: "Was de stap bij het openen van het bestand duidelijk voor jou?"
  Verwacht resultaat: < 2 van 5 testpersonen bestempelen de modal als "verwarrend"

- [ ] Stap 9: Meting open-time met de feature actief
  Bestand: n.v.t. (bench run + handmatige DevTools meting)
  Actie: meet de tijd van file-open tot de modal volledig zichtbaar is (thumbnails loaded)
  Verwacht resultaat: < 300 ms voor Variant A; ≤ 700 ms voor Variant B page 1 render

## Meet-protocol

```bash
# Stap 0 — Kritische hypothese-verificatie (voor implementatie)
# (handmatig in DevTools console, zie stap 0 hierboven)

# Voor (baseline — feature flag UIT)
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture nkd1a --scenario cold_open_p1

# Na (post-implementatie — feature flag 'modal' of 'hybrid')
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture nkd1a --scenario cold_open_p1
```

Noot: voor Variant A is de bench-harness `cold_open_p1` niet direct bruikbaar omdat de harness geen modal-interactie simuleert. Voeg een `cold_open_thumbnail_modal` scenario toe aan `pocs/shared/bench-harness.mjs` dat:
1. Het document opent
2. Wacht tot de modal zichtbaar is (via CSS selector)
3. Registreert de tijd als "modal-zichtbaar" tijdstip
4. Klikt op de eerste thumbnail
5. Registreert de tijd als "page-1-full-res-klaar" tijdstip

## Resultaten-template

Vul in als `results.md` in deze folder:

**Stap 0 — Hypothese-verificatie:**

| Meting | Resultaat (ms) | Go/stop? |
|--------|---------------|----------|
| 7× render_thumbnail sequentieel op barn (koud) | | |
| 7× render_thumbnail sequentieel op barn (warm) | | |

Als "koud" > 500 ms: **STOP — NO-GO zonder verdere implementatie.**

**Variant gekozen voor implementatie:** [ ] A (modal)  [ ] B (hybrid)  [ ] Beide

| Fixture | Scenario | Voor (ms) | Na (ms) | Delta (ms) | Delta % |
|---------|----------|-----------|---------|------------|---------|
| barn | cold_open_p1 | | | | |
| barn | modal-zichtbaar (Variant A) | | n.v.t. | | |
| barn | page-1-full-res na click (Variant A) | | | | |
| tekst | cold_open_p1 | | | | |
| nkd1a | cold_open_p1 | | | | |

**Gebruikers-test resultaten (Variant A):**
- Testpersoon 1: [ ] begrijpt modal direct  [ ] verwarrend
- Testpersoon 2: [ ] begrijpt modal direct  [ ] verwarrend
- Testpersoon 3: [ ] begrijpt modal direct  [ ] verwarrend
- Testpersoon 4: [ ] begrijpt modal direct  [ ] verwarrend
- Testpersoon 5: [ ] begrijpt modal direct  [ ] verwarrend

**Edge cases geverifieerd:**
- [ ] 1-page PDF opent direct (geen modal)
- [ ] 2-page PDF opent direct (geen modal)
- [ ] PDF met 20+ pages: modal scrollbaar en bruikbaar

**Succescriterium Variant A:** modal zichtbaar < 300 ms EN < 2/5 gebruikers "verwarrend" EN page-1-full-res na click ≤ 800 ms

**Succescriterium Variant B:** cold_open_p1 geen regressie (≤ 700 ms) EN thumbnail-strip vol binnen 500 ms

**Go/no-go beslissing:** [ ] GO (Variant A)  [ ] GO (Variant B)  [ ] NO-GO

**Toelichting:**
