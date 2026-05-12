# PoC 08 — preflight-thumbnail-ui

## Hypothese

De huidige aanname dat "open PDF = render alle pages" is onjuist voor het merendeel van de BARN-use cases; door bij document-open uitsluitend thumbnails te laden (10–50 ms elk via het bestaande `render_thumbnail` Tauri-commando) en de full-res render te reserveren voor de page die de gebruiker aanklikt, daalt de perceived open-tijd van ~1000 ms naar < 300 ms, terwijl CPU-werk voor nooit bekeken pages volledig geëlimineerd wordt.

## Rationale

Dit voorstel is afkomstig van de Luis in de Pels (Joost van der Linden) tijdens akte IX van het parlement (`parliament/index.html`): "Misschien is minder renderen het antwoord, niet sneller renderen." De eindconclusie van het parlement voegde dit expliciet als achtste PoC toe: "een fundamenteel andere UX die de vraag stelt 'moeten we überhaupt alle pages renderen?' — thumbnail-first opening met on-click full-res."

De onderbouwing is gedragsmatig, niet technisch. De Luis wees al in akte VII op het werkgedrag van Hanne: "Ze raakt page 2-7 nooit aan. In dat scenario is de prerender van pages 2-7 verspilde CPU + 180 MB verspild geheugen." (`parliament/index.html`, akte VII). Als een significante fractie van de BARN-opens resulteert in het bekijken van enkel page 1, en het systeem eager-rendert pages 1-7, dan betaalt het systeem voor werk dat nooit geconsumeerd wordt.

Concreet: het bestaande `render_thumbnail` Tauri-commando (`open-pdf-studio/src-tauri/src/lib.rs` L1276) rendert een page op lage schaal met `skip_images: true` in 10–50 ms. De Rust-side `ThumbnailCache` (L1284) maakt herhaalbare aanroepen near-instant (cache-hit). Bij een 7-page BARN: 7 × 30 ms = 210 ms voor alle thumbnails — vergeleken met de huidige ~670 ms voor enkel page 1 full-res. De full-res render van de gekozen page start dan on-click en duurt nog steeds ~670 ms, maar die wachttijd volgt op een bewuste gebruikersactie, wat perceptueel anders aanvoelt dan een passief wachten op document-open.

De `generateThumbnails()` functie in `left-panel.js` wordt al aangeroepen vanuit `loader.js` L264 direct na document-open. De thumbnails worden reeds gegenereerd als onderdeel van de normale flow. De vraag is of PoC 08 die stap naar voren haalt als *de initiële rendering* in plaats van als side-effect van de normale open-flow.

Twee implementatievarianten:

**Variant A — Modal page picker:** Bij document-open verschijnt een modale overlay met een thumbnail-grid (3×3, maximaal 9 pages). De gebruiker klikt een page; die page wordt full-res gerenderd. Pages die niet worden aangeklikt worden nooit full-res gerenderd. Dit is de meest radicale variant: kortste open-tijd, grootste UX-breuk.

**Variant B — Hybrid:** Page 1 wordt direct full-res gerenderd (behoudt de huidige "open en zie page 1" verwachting). Thumbnails van pages 2–N worden geladen in de bestaande thumbnail-strip. On-click volgt de full-res render voor die page. Dit is een minder radicale variant: open-tijd wint minder, UX-breuk is kleiner.

## Failure modes

1. **Thumbnails kosten ook ~1 seconde als de Rust-backend al bezig is.** De cruciale aanname is dat `render_thumbnail` 10–50 ms duurt. Maar als bij document-open de `font_registry` Mutex (de root-cause van PoC 01) nog niet ontgrendeld is omdat een andere thread bezig is, kan ook de thumbnail-render wachten. Verificatie vóór implementatie: meet de werkelijke duur van 7× `render_thumbnail` aanroepen in sequentie op een koud systeem. Als die meting > 500 ms is, is de hypothese van PoC 08 (open-tijd < 300 ms) onhaalbaar en is het GO/NO-GO al bepaald zonder implementatie.

2. **Gebruiker verwart de modal page picker (Variant A) met een bestandsopener.** Een modale overlay bij document-open zit in dezelfde interactie-positie als een file-picker of een "wil je dit document opslaan?" dialoog. Gebruikers kunnen reflexmatig op Escape drukken en het document onbedoeld sluiten. Het design moet visueel ondubbelzinnig zijn: de thumbnail-grid moet eruitzien als een "welke page wil je zien?" keuze, niet als een bestandsselectie. Dit vereist helder copywriting ("Kies een pagina om te openen") en een afwijkend visueel patroon van de bestaande modals.

3. **Voor 1- of 2-page PDFs is de picker overhead zinloos.** Een 1-page PDF heeft geen keuze; de picker tonen is pure extra klik. Een 2-page PDF heeft slechts twee opties; de picker voegt friction toe zonder voordeel. Implementatie-regel: sla de picker over als het document ≤ 2 pages heeft en render direct full-res op page 1.

4. **De thumbnail-strip in Variant B verwacht thumbnails al bij open — dat is de huidige situatie.** Als Variant B wordt gekozen en de bestaande `generateThumbnails()` flow al werkt bij document-open, is de architecturele wijziging minimaal: alleen de full-res render van pages 2-N wordt uitgesteld. De thumbnail-strip gaat in dat geval verder de same als nu. In dat geval is de open-time winst nul (de thumbnails lopen al parallel met page 1 render).

5. **Gebruiker verwacht "open en zie page 1" — Variant A breekt dit fundamenteel.** Dit is de grootste UX-risico. In vrijwel elke desktop PDF-applicatie (ook Acrobat Pro's "page navigator" panel) is het paradigma: open = ga naar page 1. Een tussenstap vóór de eerste page-weergave is een breuk met een decennium-lang gegroeide verwachting. Als gebruikers-tests aantonen dat > 50% van de testpersonen de modal als verwarrend ervaart, is dit een definitieve NO-GO voor Variant A — ongeacht de open-time-winst.

6. **On-click full-res render geeft alsnog 670 ms latentie na de click.** De perceptie-winst van PoC 08 is enkel bij het openen van het document. Zodra de gebruiker een thumbnail aanklikt en wacht op de full-res render, zit hij alsnog 670 ms te wachten — nu echter na een bewuste actie. Of die latentie acceptabeler voelt is afhankelijk van de gebruiker. Combinatie met PoC 07 (skeleton + low-res preview) is een voor de hand liggende aanvulling.

## Succescriterium

**Go voor Variant A** als:
- De gemeten open-tijd (tijd van file-open tot modal volledig zichtbaar met thumbnails) < 300 ms is op de `barn` fixture
- Minder dan 2 van 5 testpersonen de modal als "verwarrend" of "onverwacht" bestempelen
- De full-res render na click ≤ 800 ms duurt (huidige basislijn: ~670 ms — mag marginaal hoger zijn door context-switch)

**Go voor Variant B** als:
- De open-tijd van page 1 full-res op `barn` < 700 ms is (huidige basislijn ~670 ms — geen regressie)
- De thumbnail-strip voor pages 2-7 volledig gevuld is binnen 500 ms na page 1 render klaar
- Gebruikers-test: 0 van 5 testpersonen merkt een gedragsverandering (transparante verbetering)

**No-go** als de gemeten thumbnail-render (7× `render_thumbnail` op `barn`) > 500 ms kost (dan vervalt de hypothese geheel), of als Variant A meer dan 40% negatieve gebruikers-feedback genereert.

## Verwachte effort

1-2 dagen. Het merendeel is UX-werk: het ontwerpen en implementeren van de modal of hybrid UI, en het uitvoeren van gebruikers-tests. De technische implementatie (onderscheppen van de document-open flow in `loader.js` L263–264) is klein; het UX-design is de hoofdmoot.

## Risico

**Hoog.** Dit is een fundamentele UX-breuk met het bestaande interactie-paradigma. De technische implementatie is laag-risico, maar de gebruikersreactie is onvoorspelbaar. PoC 08 *kan* PoCs 04-07 gedeeltelijk overbodig maken als de open-time winst groot genoeg is en de UX-test positief uitpakt — maar het kan ook volledig worden verworpen na gebruikers-test. Dat is de juiste uitkomst van een PoC.

## Pre-existing context

- `open-pdf-studio/js/pdf/loader.js` L263–264 — `generateThumbnails()` aanroep direct na document-open; de locatie waar PoC 08 ingrijpt
- `open-pdf-studio/js/ui/panels/left-panel.js` L201–267 — de volledige `generateThumbnails()` functie en de bijbehorende thumbnail-cache
- `open-pdf-studio/js/ui/panels/left-panel.js` L279–298 — `pauseThumbnails()` / `resumeThumbnails()` mechanisme
- `open-pdf-studio/src-tauri/src/lib.rs` L1276–1325 — `render_thumbnail` Rust command met eigen Rust-side cache (`ThumbnailCache`)
- `parliament/index.html` akte VII (Luis over Hanne's workflow: "ze raakt pages 2-7 nooit aan"), akte IX (eindconclusie: "ACHTSTE PoC als alternatief paradigma")
- `pocs/README.md` — "PoC 08 als alternatief paradigma — kan PoCs 04-07 overbodig maken"
- `pocs/shared/bench-harness.mjs` — meet-infrastructuur; scenario `cold_open_p1` meet huidige open-time basislijn

### ASCII wireframe Variant A — Modal page picker

```
┌─────────────────────────────────────────────────────────┐
│  2459-TO_Fragmenten.pdf — Kies een pagina               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌───────┐   ┌───────┐   ┌───────┐                    │
│   │  [1]  │   │  [2]  │   │  [3]  │                    │
│   │ thumb │   │ thumb │   │ thumb │                    │
│   │       │   │       │   │       │                    │
│   └───────┘   └───────┘   └───────┘                    │
│    Pagina 1    Pagina 2    Pagina 3                      │
│                                                         │
│   ┌───────┐   ┌───────┐   ┌───────┐                    │
│   │  [4]  │   │  [5]  │   │  [6]  │                    │
│   │ thumb │   │ thumb │   │ thumb │                    │
│   │       │   │       │   │       │                    │
│   └───────┘   └───────┘   └───────┘                    │
│    Pagina 4    Pagina 5    Pagina 6                      │
│                                                         │
│              ┌───────┐                                  │
│              │  [7]  │                                  │
│              │ thumb │      [Ga naar pagina 1 →]        │
│              └───────┘                                  │
│               Pagina 7                                  │
└─────────────────────────────────────────────────────────┘
```

### ASCII wireframe Variant B — Hybrid

```
┌─────────────────────────────────────────────────────┐
│  ┌──────┐  ┌──────────────────────────────────────┐ │
│  │ [1]  │  │                                      │ │
│  │thumb │  │  Page 1 — full-res (direct geladen)  │ │
│  │──────│  │                                      │ │
│  │ [2]  │  │                                      │ │
│  │thumb │  │                                      │ │
│  │──────│  └──────────────────────────────────────┘ │
│  │ [3]  │                                           │
│  │thumb │    ↑ klik thumbnail → full-res on-demand  │
│  │──────│                                           │
│  │ ...  │                                           │
└──┴──────┴───────────────────────────────────────────┘
```
