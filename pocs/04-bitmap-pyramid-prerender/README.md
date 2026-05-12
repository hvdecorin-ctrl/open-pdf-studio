# PoC 04 — bitmap-pyramid-prerender

## Hypothese

Bij `DocumentHandle::load` start een rayon-threadpool die ALLE pages van het document parallel rendeert naar de bestaande `pixmap_cache` op Base tier (schaal 1.0× × DPR), zodat de gebruiker bij het scrollen naar page 2–7 van BARN een cache-hit krijgt in plaats van een cold render van ~670 ms per page.

## Rationale

De bestaande `PageBitmapCache` in `open-pdf-render/src/parser.rs` L24–77 is al aanwezig en werkend. Bij een cache-hit op L287–300 retourneert `render_page_internal` de gecachede RGBA in ~10 ms. Het probleem is dat de cache passief is: hij wordt alleen gevuld wanneer de gebruiker al op die page is beland. De eerste scroll over alle 7 BARN-pages is dus altijd cold.

Het parlement (zie `parliament/index.html`, sectie "Veteraan's standpunt") formuleerde dit exact:

> "Foundation eerst, gemeten per stap. Drie caches doc-scope (image, glyph, parsed-content) + RwLock font. Pas DAN bitmap pyramid."

En `pocs/README.md`, volgorde punt 3:

> "PoC 04 als hoofdmoot — bouw alleen op de geverifieerde foundation van 01-03."

De hypothese voor PoC 04 is dat een eagere vul-strategie de 4.7 s cold-scroll (7 × ~670 ms) omzet in een serie cache-hits van ~10 ms per page. De rayon-infrastructuur bestaat al in `parser.rs` L911–938: `extract_text_spans_batch`, `extract_draw_commands_batch` en `page_dimensions_all` gebruiken allemaal `par_iter`. Een parallelle render-batch volgt hetzelfde patroon, maar schrijft naar `pixmap_cache` in plaats van een resultaatsvector te retourneren.

Met PoC 01 (RwLock op `font_registry`) actief, kunnen de parallelle renders voor BARN hun font-lookups gelijktijdig doen. Op een machine met 4 vrije cores: 7 pages × 670 ms / 4 cores ≈ 1.2 s achtergrondtijd. De gebruiker bemerkt dit niet — de prerender draait terwijl de eerste page al getoond wordt.

De cache-key is `PageCacheKey { page_idx, scale_q, rotation }` (L30–35 in parser.rs). De schaal voor de prerender is `user_scale × DPR` zoals bepaald door de JS-kant bij document-open. Dit vereist dat de JS-kant de gewenste schaal meegeeft aan de Tauri-command die de prerender start.

Memory budget: de bestaande `PageBitmapCache` heeft capaciteit 12 (L89 in parser.rs). BARN bij scale 1.0 heeft ~7 pages × ~30 MB RGBA = ~210 MB. Capaciteit 12 past hier ruim in. Voor grotere documenten (> 100 pages) moet de prerender beperkt worden tot de eerste N pages (bijv. 20) plus lazy-on-demand voor de rest. De globale LRU-evictie (L37–78 in parser.rs) zorgt dat de cache nooit explodeert — oudste entries worden verdrongen.

## Failure modes

1. **Prerender blokkeert de eerste page render.** Als de tokio-threadpool van Tauri en de rayon-threadpool van de prerender dezelfde OS-threads betwisten, kan de eerste page render (foreground, user-zichtbaar) vertraagd worden doordat de CPU bezet is met achtergrond-prerenders. Mitigatie: start de prerender pas nadat de eerste page volledig gerenderd en getoond is. In de JS-kant: roep `start_background_prerender` pas aan in de `.then()` callback van het eerste `render_pdf_page` command.

2. **Schaal-mismatch bij prerender vs daadwerkelijk render.** De prerender draait op schaal `s`. Als de gebruiker bij het scrollen een andere schaal heeft (zoom in/out tussendoor), zijn de prerender-resultaten de verkeerde schaal en is er geen cache-hit. De JS-kant moet de schaal waartegen ge-prerenderd werd bijhouden en opnieuw prerenderen bij zoom-wijziging. Dit is extra state-management complexiteit.

3. **Geheugenexplosie bij groot document.** Een 100-page PDF bij scale 1.5 (DPR 1.0) = 100 × ~60 MB = 6 GB RGBA. De LRU-evictie houdt dit op capaciteit 12 (720 MB), maar dan zijn pages 13–100 al uit de cache verdrongen voordat de gebruiker ze bereikt. De 700 MB budget is reëel voor BARN maar ongeschikt voor documenten van honderden pages. Mitigatie: begrens de prerender tot min(page_count, 20) en start lazy-on-demand voor de rest.

4. **Race condition: prerender insert vs foreground render insert.** Als de foreground render van page 3 begint terwijl de achtergrond-prerender van page 3 nog bezig is, vullen ze allebei dezelfde cache-key. Beide renderen correct; de tweede insert overschrijft de eerste zonder pixel-verschil. Maar de `Mutex<PageBitmapCache>` serialiseert de inserts al (L394 in parser.rs), dus dit is veilig — alleen licht inefficiënt (dubbele render). Mitigatie: check in de prerender-loop voor insert of de key al aanwezig is.

5. **Tauri command overhead voor alle pages.** Als de prerender elke page als een apart `render_pdf_page` Tauri-command implementeert, is er 7 × IPC-overhead (~100 ms per command = 700 ms extra). Mitigatie: implementeer een nieuw `prerender_all_pages` command dat één keer wordt aangeroepen en de rayon-loop intern afhandelt zonder per-page IPC.

6. **Prerender wast energie bij documenten die de gebruiker snel sluit.** Als de gebruiker een document opent en meteen sluit, zijn de 7 achtergrond-renders nutteloos geweest. Dit is acceptabel — het is best-effort werk. Wel moet de prerender stoppen als `DocumentHandle` gedropped wordt, anders paniceert de rayon-thread op een dangling reference.

## Succescriterium

**Go** als `scroll_p1_to_p7` op fixture `barn` daalt van baseline ~4700 ms naar ≤ 500 ms (median over 3 runs), gemeten nadat de prerender volledig klaar is (wacht minimaal 2 s na document-open voor de bench start).

**No-go** als de daling kleiner is dan 50% (> 2350 ms), of als `cold_open_p1` op `barn` met meer dan 10% stijgt doordat de prerender de foreground render vertraagt.

Controle: meet ook `cold_open_p1` op `tekst` (kleine PDF, prerender overhead mag daar ≤ 20 ms zijn).

## Verwachte effort

2–3 dagen. De complexiteit zit niet in de prerender-logica zelf (dat is één rayon-loop bovenop bestaande code), maar in de JS–Rust coördinatie: schaal doorgeven, prerender uitstellen tot na de eerste page render, en de schatting van wanneer de prerender klaar is.

## Risico

**Middel.** De prerender-logica zelf is mechanisch en bouwt op bestaande infra. De risico's zijn voornamelijk memory (beheersbaar met capaciteitslimiet) en schaal-mismatch (vereist extra state in de JS-kant). De grootste onbekende is het CPU-interferentie-effect op de eerste page render — dit is empirisch te meten in stap 3 van het plan.

## Pre-existing context

- `parliament/index.html` — bitmap pyramid als "Laag 2 — Output" in de twee-laags architectuur; debat over "foundation eerst" vs "pyramid eerst"
- `pocs/README.md` — PoC 04 als "hoofdmoot", pas bouwen na verified foundation van PoC 01-03
- `open-pdf-render/src/parser.rs` L24–77 (`PageBitmapCache`, `CachedPageBytes`, `PageCacheKey` — de bestaande cache-infra)
- `open-pdf-render/src/parser.rs` L79–91 (`DocumentHandle::load` — de plek voor prerender-initialisatie)
- `open-pdf-render/src/parser.rs` L259–401 (`render_page_internal` — het pad dat wordt aangeroepen per prerender)
- `open-pdf-render/src/parser.rs` L911–938 (bestaande rayon-batch-functies als patroon voor de prerender-loop)
- `open-pdf-studio/js/pdf/renderer.js` L78–141 (`_schedulePreRenderAdjacent` — bestaande JS-kant prerender voor zoom-levels, als vergelijkingspunt)
- `open-pdf-studio/js/pdf/renderer.js` L40–76 (JS-side bitmap LRU cache — werkt samen met maar onafhankelijk van de Rust-side pixmap cache)
- PoC 01 (font-registry-rwlock) — vereist actief voor maximale parallelisatie van de prerender
