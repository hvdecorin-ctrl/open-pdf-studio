# PoC 05 — doc-glyph-cache

## Hypothese

De `glyph_path_cache` in `interpreter.rs` L266 heeft een per-render levensduur: hij wordt aangemaakt bij het begin van `execute_internal` en gedropped aan het einde. Door de cache te verplaatsen naar `DocumentHandle` scope worden tiny-skia `Path`-objecten voor glyphs die op meerdere pages van dezelfde PDF voorkomen slechts éénmaal geconstrueerd, wat 50–100 ms bespaart op pages 2+ van text-zware documenten.

## Rationale

De glyph path cache is geïntroduceerd in iter-23 (zie de commentaarregel boven L258 in `open-pdf-render/src/interpreter.rs`):

> "Speed iter-23: each text-show op (Tj/TJ) used to build a fresh tiny-skia Path from the cached OutlineCommands for every glyph instance — for Zware vector PDF p3/p5 (387 Tj × ~30 chars ≈ 12k glyph fills per page) this was the largest single chunk of CPU. Caching the tiny-skia Path by (font_object_id, glyph_id) cuts the per-page render time on text-heavy pages by 50-65%."

Dit is een significante within-page winst. De beperking is de scope: `glyph_path_cache` (L266) wordt gedeclareerd binnen `execute_internal` (L228) en is dus per-render. Bij de render van page 2 begint de cache leeg, ook al zijn de glyphs van dezelfde fonts al verwerkt op page 1.

De cache-key is `(lopdf::ObjectId, u32)` — een tuple van het font-objectID en de glyph-ID. Dit is al stabiel: `lopdf::ObjectId` is `(u32, u16)` en is deterministisch per PDF-bestand (het is de directe object-referentie in het PDF-cross-reference table). Dezelfde font op page 1 en page 2 heeft exact hetzelfde `ObjectId`. De glyph-ID is de code-point of CID zoals verwerkt door de font-parser. De cache-key hoeft dus niet te wijzigen.

De enige wijziging is de scope: de `HashMap<(ObjectId, u32), tiny_skia::Path>` verplaatst van een lokale variabele in `execute_internal` naar een veld op `DocumentHandle`. Omdat `DocumentHandle` via `Arc<RwLock<...>>` gedeeld wordt tussen threads (Tauri commandhandler + achtergrond-prerenders van PoC 04), moet de glyph cache thread-safe zijn. `tiny_skia::Path` is `Send + Sync`, dus een `Arc<RwLock<HashMap<(ObjectId, u32), tiny_skia::Path>>>` volstaat.

Voor BARN (7 pages, ~5 unieke fonts, ~500–1000 unieke glyphs per font) is de verwachte winst: page 1 vult de cache koud (geen winst), pages 2–7 treffen cache-hits voor alle herhaalende glyphs. Bij 50% cache-hit rate (conservatief) en een gemiddelde glyph-fill kostprijs van ~0.1 ms, is de winst op een text-zware page ~50 ms. Voor Zware vector PDF (het document dat iter-23 motiveerde) is de winst groter.

De memory-impact is gering: `tiny_skia::Path` is een compacte reeks bezier-segmenten. Een font met 500 unieke glyphs × ~50 bytes per Path = ~25 KB per font. Voor 5 fonts = ~125 KB — verwaarloosbaar.

## Failure modes

1. **Thundering herd bij parallelle prerender (PoC 04 + PoC 05 samen).** Als de rayon-prerender van PoC 04 pages 1–7 parallel rendert, proberen meerdere threads gelijktijdig de glyph cache te schrijven (insert voor nieuwe glyphs). Een `RwLock` serialiseert de writes: threads die op een write-lock wachten staan te wachten achter elkaar. Bij een font met 1000 unieke glyphs op page 1 worden 1000 write-locks verkregen. Als page 2 tegelijk runt, wacht hij bij elke write. In het ergste geval is de write-contention op de glyph cache zwaarder dan de win van het hergebruik — namelijk als glyphs-per-page × pages parallel × lock-acquisitie-tijd > glyph-construction-tijd. Mitigatie: gebruik `DashMap` (concurrent hash map, geen lock nodig voor reads, gedeeld lock per shard voor writes) in plaats van `RwLock<HashMap>`.

2. **tiny_skia::Path is niet Clone in alle versies.** De huidige code in `execute_internal` muteert de `Path` niet — hij wordt alleen ingelezen na constructie. Maar om de Path uit een `RwLock<HashMap>` te delen zonder de lock vast te houden tijdens het renderen, moet hij gecloned worden bij elke cache-hit. Als `tiny_skia::Path` geen `Clone` implementeert, moet de cache `Arc<tiny_skia::Path>` opslaan zodat de hit-pad alleen een Arc-clone doet (een atomische increment, ~1 ns). Verifieer `Clone` vóór implementatie.

3. **Cache wordt onbegrensd voor lange sessies.** Als de gebruiker meerdere PDFs opent in dezelfde sessie, groeit de glyph cache van elke `DocumentHandle` onbeperkt. In de praktijk is dit acceptabel — `DocumentHandle` wordt gedropped als de PDF gesloten wordt, wat de cache meeneemt. Maar als een PDF met 500 unieke fonts (bijv. een tijdschrift-layout met per-artikel embedded fonts) nooit gesloten wordt, kan de cache tientallen MB groot worden. Mitigatie: voeg een capaciteitslimiet toe (bijv. max 10.000 entries; LRU-evictie daarna).

4. **Path-representatie is schaalafhankelijk.** De `tiny_skia::Path` die wordt geconstrueerd vanuit `OutlineCommands` wordt gerenderd op de device-ruimte-schaal van de huidige render. Als page 1 gerenderd werd op scale 1.0 en page 2 op scale 1.5, zijn de gecachede Paths van page 1 incorrect voor page 2 (de coordinaten zijn in de verkeerde eenheid). Verificeer of de Path-constructie schaalinvariant is (in glyph-space, vóór de CTM-transformatie wordt toegepast). Als dat zo is, is de cache schaal-onafhankelijk. Als niet, moet de cache-key de schaal bevatten.

5. **`execute_internal` wordt ook aangeroepen voor Form XObjects en annotatie-streams.** Recursieve aanroepen via `Self::execute_internal` op L606, L634, L643 en L3067 in interpreter.rs kunnen dezelfde glyph cache raken voor Form XObject content. Dit is correct gedrag — gedeelde glyphs worden gedeeld. Maar de `&mut glyph_path_cache`-parameter in de huidige signatuur moet worden vervangen door een gedeelde `Arc<RwLock<...>>` op alle call sites. Dit zijn 4 extra aanpassingen bovenop de hoofdwijziging.

## Succescriterium

**Go** als `scroll_p1_to_p7` op fixture `barn` daalt met ≥ 100 ms totaal (median over 3 runs) op de passage pages 2–7, EN als `cold_open_p1` op fixture `zware-vector` daalt met ≥ 50 ms (zware-vector is het document waarvoor iter-23 de within-page cache introduceerde — de cross-page winst is hier het grootst).

**No-go** als de totale daling kleiner is dan 30 ms, of als write-contention op de gedeelde glyph cache de render van page 1 vertraagt met meer dan 5%.

Controle: `cold_open_p1` op `barn` mag niet meer dan 5% stijgen (er is geen cross-page winst op page 1; de overhead van de gedeelde cache mag niet zichtbaar zijn).

## Verwachte effort

½ dag. De wijziging is uitsluitend een scope-verbreding van een bestaande `HashMap`. De complexiteit zit in het kiezen van de juiste thread-safe container (`RwLock<HashMap>` vs `DashMap`) en het verifiëren dat `tiny_skia::Path` correct Clone/Arc-compatibel is.

## Risico

**Laag.** De cache-key is stabiel en niet controversieel. De only-append semantiek (inserts, nooit deletes) maakt invalidatie overbodig. De verandering is volledig reversibel: als de doc-scoped cache geen meetbare winst geeft, is het eenvoudig terugdraaien naar de per-render variant.

## Pre-existing context

- `open-pdf-render/src/interpreter.rs` L258–267 — per-render `glyph_path_cache` met uitleg van iter-23 en de motivatie
- `open-pdf-render/src/interpreter.rs` L228–267 — `execute_internal` signatuur en de scope van de cache-declaratie
- `open-pdf-render/src/interpreter.rs` L424–452 — de 4 call sites van `execute_show_string` / `execute_show_array` die `&mut glyph_path_cache` doorgeven
- `open-pdf-render/src/interpreter.rs` L606, L634, L643, L3067 — recursieve `execute_internal` calls voor Form XObjects en annotatie-streams
- `open-pdf-render/src/parser.rs` L64–91 — `DocumentHandle` struct en `::load` constructor, de landingsplek voor het nieuwe cache-veld
- `parliament/index.html` — "drie caches doc-scope (image, glyph, parsed-content)" als recommended foundation set
- PoC 02 (doc-image-cache) — identiek patroon voor image cache, als structureel voorbeeld voor deze wijziging
