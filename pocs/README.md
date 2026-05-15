# Proof of Concept Onderzoeksprogramma

> **Doel:** valideer empirisch welke architectuur-elementen voor Open PDF Studio's render-pijplijn echt de impact hebben die het parlement op 12 mei 2026 vermoedde. Geen architectuurkeuze tot na meting.

## Achtergrond

Het parlement (zie `parliament/index.html`) heeft op 12 mei 2026 een twee-laags cache architectuur voorgesteld voor PDF rendering. De Geschiedkundige heeft echter aangetoond dat dit project sinds september 2025 een patroon van *build-then-measure-then-revert* heeft gehad — vier weken werk leverde 35 regels productive code op main. De Gebruiker eist daarom expliciet: **eerst PoCs, dan keuze, dan productie**.

Dit programma omvat **acht PoCs**, plus optioneel een negende. Elke PoC test één hypothese met meting op BARN + minstens 2 andere PDFs uit het corpus. Geen PoC mag worden gemerged naar main zonder go/no-go beslissing op basis van data.

## De acht PoCs

| # | Naam | Hypothese (één zin) | Status | Effect |
|---|---|---|---|---|
| 01 | font-registry-rwlock | `font_registry` Mutex → RwLock laat parallel page renders 2-3× sneller draaien op multi-core | **NO-GO** | -60% (regressie — alle hot-path call sites vereisen `&mut self`, RwLock degradeert tot trager Mutex) |
| 02 | doc-image-cache | Doc-scoped decoded image cache scheelt per re-render bij overlappende images tussen pages | **GO — gemerged** | BARN scroll −41%, scroll-back-revisit −73%, NKD1a scroll −59% |
| 03 | axis-aligned-draw-pixmap | `draw_pixmap` voor axis-aligned image draws vermindert 30-50% van image-rasterization tijd | **NO-GO** | Geen meetbare winst (tiny_skia's `fill_path(rect, Pattern)` compileert al naar een blit-equivalent) |
| 04 | bitmap-pyramid-prerender → pixmap cache | Cache de volledige gerenderde pixmap per (page, scale, rot) — bypass alle render-werk op revisit | **GO — gemerged** | BARN scroll-back −89% (7.3 s → 0.8 s, 9.4×), NKD1a scroll −92% (24 s → 2 s, 11.8×) |
| 05 | doc-glyph-cache | Doc-scoped glyph path cache (i.p.v. per-render) scheelt 50-100ms op multi-page docs | **NO-GO** | Geen winst op cold pages, +30% regressie op warm pages — PoC 04 maakte het overbodig |
| 06 | highres-tier-on-demand | Lazy 2× tier render bij eerste zoom-in geeft instant zoom zonder open-tijd te belasten | TODO | Mogelijk overbodig nu PoC 04 zoom op cached pixmap doet |
| 07 | ui-progressive-feedback | Met visuele feedback (low-res preview + fade-in hi-res) voelt traagheid 2× minder erg | TODO | UX-laag — los van Rust-side metingen |
| 08 | preflight-thumbnail-ui | Open BARN toont eerst thumbnail-strip; hi-res render alleen op klik. *Minder renderen i.p.v. sneller* | TODO | UX shift — minder renderen i.p.v. sneller renderen |

### Samenvatting impact PoC 02 + PoC 04 (samen gemerged op main)

Op BARN (raster-engineering, primaire test):

| Scenario | Pre-PoC baseline | Na PoC 02+04 | Speedup |
|----------|------------------|--------------|---------|
| Cold open page 1 | 797 ms | 833 ms | -4% (binnen ruis) |
| Scroll p1→p7 (warm) | 3357 ms | 870 ms | **3.9× sneller** |
| Zoom in/out revisit | 1300 ms | 339 ms | **3.8× sneller** |
| Scroll terug (revisit) | 7301 ms | 776 ms | **9.4× sneller** |

NKD1a (raster-engineering, ATLAS-stress, 220 image-Do-refs):
- Scroll p1→p7: 23.9 s → 2.0 s = **11.8× sneller** (-21.9 sec)

zware-vector (30 pages, pure vector):
- Zoom revisit: 1.5 s → 0.18 s = **8.2× sneller**

Volgende stappen bezien op grond van bovenstaande: PoC 06/07/08 zijn UX-laag verbeteringen. PoC 04 heeft de
Rust-side render performance al onder de Microsoft-2019 100ms-per-render drempel gebracht voor warme paths.

**Optioneel — PoC 9 (geen aparte directory tot besluit):** gerichte Vello-met-tuning na de Veteraan's correctie dat Plan A is *geparkeerd*, niet definitief afgewezen.

## Werkwijze per PoC

1. **Lees** het bestaande `README.md` van de PoC voor hypothese, rationale en succescriterium.
2. **Lees** het `plan.md` voor stappenplan.
3. **Voer** de implementatie uit op een eigen branch `poc/<nr>-<naam>`.
4. **Meet** met de gedeelde harness uit `shared/bench-harness.mjs` op het corpus uit `shared/corpus.json`.
5. **Vul** `results.md` met:
   - Voor-meting (baseline)
   - Na-meting (post-implementatie)
   - Per-PDF diff
   - Go/no-go conclusie tegen het succescriterium
6. **Beslis** met de project owner: doorvoeren naar main? Aanpassen? Verwerpen?

## Volgorde

De Geschiedkundige heeft aangedrongen op de volgende prioriteit:

1. **PoC 01 eerst** (`font-registry-rwlock`) — de bekende-en-niet-aangedane root cause, hoogste perceived impact, laagste risico.
2. **PoC 02 en 03** parallel — beide goedkope foundation fixes met directe meetbare impact.
3. **PoC 04** als hoofdmoot — bouw alleen op de geverifieerde foundation van 01-03.
4. **PoC 05, 06, 07** als aanvullende winsten.
5. **PoC 08** als alternatief paradigma — *kan* PoCs 04-07 overbodig maken als deze fundamenteel een betere UX is.

## Stop-criterium

Conform de /loop discipline uit eerdere parity loops:
- **Doorgaan** zolang elke PoC meetbare verbetering oplevert tegen het succescriterium
- **Stoppen** bij 3 opeenvolgende PoCs zonder verbetering — dan is het architectureel probleem fundamenteler
- **Definitief stoppen** wanneer BARN onder de Microsoft-2019 100ms drempel voor interaction zit

## Niet doen tijdens dit programma

- ❌ Code mergen naar main zonder PoC-go-keuze + data
- ❌ Subagent dispatch voor architectuur-evaluatie (alleen voor mechanische implementatie)
- ❌ Twee PoCs combineren in één commit — verlies van isolatie
- ❌ Lopende PoC verlaten omdat een nieuw idee leuker lijkt — afmaken eerst

## Bestanden

```
pocs/
├── README.md                       (dit bestand)
├── shared/
│   ├── bench-harness.mjs           (CDP-based meet-infra)
│   ├── measure-baseline.mjs        (huidige main state baseline)
│   └── corpus.json                 (test PDFs + run config)
├── 01-font-registry-rwlock/
│   ├── README.md                   (hypothese + rationale)
│   ├── plan.md                     (implementatie stappenplan)
│   └── results.md                  (in te vullen na bench)
├── 02-doc-image-cache/             (idem)
├── 03-axis-aligned-draw-pixmap/    (idem)
├── 04-bitmap-pyramid-prerender/    (idem)
├── 05-doc-glyph-cache/             (idem)
├── 06-highres-tier-on-demand/      (idem)
├── 07-ui-progressive-feedback/     (idem)
└── 08-preflight-thumbnail-ui/      (idem)
```
