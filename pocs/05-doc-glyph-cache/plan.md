# PoC 05 implementatieplan

## Vooraf

- Branch: `poc/05-doc-glyph-cache` vanaf main HEAD (niet vanaf poc/04 branch — onafhankelijke PoC)
- Eerst baseline meten: zie `pocs/shared/measure-baseline.mjs`
- Lees `open-pdf-render/src/interpreter.rs` L228–267 voor de scope van de huidige `glyph_path_cache`
- Lees `open-pdf-render/src/interpreter.rs` L595–650 voor de recursieve `execute_internal` call-sites (Form XObjects)
- Verifieer vóór implementatie of `tiny_skia::Path` `Clone` implementeert: `grep -n "impl Clone" $(find . -path "*/tiny-skia*" -name "*.rs")`

## Pre-requisites

| PoC | Status vereist | Reden |
|-----|---------------|-------|
| Geen | n.v.t. | PoC 05 is onafhankelijk van PoC 01–04; werkt ook zonder RwLock font_registry |

## Stappen

- [ ] Stap 1: Baseline meten op scroll_p1_to_p7 + cold_open_p1 (barn en zware-vector)
  Bestand: n.v.t. (bench run)
  Verwacht resultaat: scroll_p1_to_p7 barn ≈ 4700 ms; cold_open_p1 zware-vector ≈ 400 ms (geschat)

- [ ] Stap 2: Verifieer of `tiny_skia::Path` `Clone` of `Arc`-packaging vereist
  Bestand: Cargo.lock of tiny-skia source in het vendor-dir
  Actie: zoek `impl Clone for Path` in tiny-skia; als aanwezig, gebruik directe clone in cache; als afwezig, wrap in `Arc<tiny_skia::Path>`
  Verwacht resultaat: duidelijkheid over het type dat de doc-cache opslaat

- [ ] Stap 3: Voeg een doc-scoped glyph cache toe aan `DocumentHandle`
  Bestand: `open-pdf-render/src/parser.rs` L64–77 (struct definitie) en L83–90 (constructor)
  Actie: voeg toe:
  - veld: `glyph_path_cache: Arc<std::sync::RwLock<std::collections::HashMap<(lopdf::ObjectId, u32), tiny_skia::Path>>>`
    (of `Arc<tiny_skia::Path>` als Clone ontbreekt)
  - initialisatie in `DocumentHandle::load` (L83): `glyph_path_cache: Arc::new(RwLock::new(HashMap::new()))`
  Verwacht resultaat: compileert; geen wijziging in gedrag

- [ ] Stap 4: Wijzig de signatuur van `execute_internal` om de doc-scoped cache te accepteren
  Bestand: `open-pdf-render/src/interpreter.rs` L228–236 (functiesignatuur)
  Actie: voeg parameter toe:
  `doc_glyph_cache: Option<Arc<RwLock<HashMap<(lopdf::ObjectId, u32), tiny_skia::Path>>>>`
  Als `None`, gedraagt de functie zich identiek aan de huidige implementatie (fallback naar lokale cache).
  Verwacht resultaat: compiler geeft fouten op alle call sites — dit is de worklist voor stap 5

- [ ] Stap 5: Pas de call sites van `execute_internal` aan
  Bestand: `open-pdf-render/src/interpreter.rs` L210, L225 (`execute` en `execute_with_image_limit` wrappers)
  en `open-pdf-render/src/parser.rs` L193, L359 (aanroepen vanuit parser)
  Actie: geef `Some(Arc::clone(&self.doc_glyph_cache))` mee vanuit de parser; geef `None` mee bij de recursieve Form XObject calls (L606, L634, L643, L3067) — Form XObjects gebruiken hun eigen resources dict en hun glyph-IDs kunnen overlappen met de page-level cache op een manier die nog niet geverifieerd is
  Verwacht resultaat: compileert

- [ ] Stap 6: Implementeer de merge-logica in `execute_internal`
  Bestand: `open-pdf-render/src/interpreter.rs` L266–267 (huidige cache-declaratie)
  Actie: vervang de lokale `let mut glyph_path_cache` door:
  ```rust
  // Doc-scoped glyph cache: verwijder de lokale declaratie en werk via de Arc
  // Read-pad: haal Path op via read-lock, return Arc-clone of directe clone
  // Write-pad: voeg nieuwe Path in via write-lock (insert_if_absent)
  ```
  Concreet: bij elke cache-lookup in `execute_show_string` / `execute_show_array` (L424–452):
  1. Probeer read-lock → lookup → return clone bij hit
  2. Bij miss: construeer Path, verkrijg write-lock, insert (check nogmaals voor thundering herd)
  Verwacht resultaat: pages 2–7 treffen cache-hits voor glyphs die al op page 1 geconstrueerd zijn

- [ ] Stap 7: Verifieer dat `execute_show_string` en `execute_show_array` correct werken met de nieuwe signatuur
  Bestand: `open-pdf-render/src/interpreter.rs` (de functies die `&mut glyph_path_cache` als parameter accepteren op L424–452)
  Actie: pas de signatuur van die hulpfuncties aan naar `glyph_cache: &Arc<RwLock<...>>`
  Verwacht resultaat: compileert; geen logica-wijziging

- [ ] Stap 8: Log het aantal cache-hits en -misses na render van BARN p1 en p2
  Bestand: `open-pdf-render/src/interpreter.rs` (tijdelijk `eprintln!` bij hit en miss in stap 6)
  Verwacht resultaat: p2 toont > 50% hits voor de glyph-IDs die ook op p1 voorkwamen

- [ ] Stap 9: `cargo build --release` draaien op `open-pdf-render`
  Verwacht resultaat: geen compile-fouten; geen nieuwe Clippy warnings over RwLock of Arc-clones

- [ ] Stap 10: Post-implementatie meting
  Verwacht resultaat: scroll_p1_to_p7 barn delta ≥ 100 ms; cold_open_p1 zware-vector delta ≥ 50 ms

## Meet-protocol

```bash
# Voor (baseline)
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture zware-vector --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1

# Na (post-implementatie)
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture zware-vector --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
```

## Resultaten-template

Vul in als `results.md` in deze folder:

| Fixture | Scenario | Voor (ms) | Na (ms) | Delta (ms) | Delta % |
|---------|----------|-----------|---------|------------|---------|
| barn | scroll_p1_to_p7 | | | | |
| barn | cold_open_p1 | | | | |
| zware-vector | cold_open_p1 | | | | |
| tekst | cold_open_p1 | | | | |

**Glyph cache hit-rate barn p2 (% glyphs als hit):** ___%

**Tiny_skia::Path Clone aanwezig:** [ ] Ja (directe clone)  [ ] Nee (Arc-wrapper)

**Succescriterium:** scroll_p1_to_p7 barn delta ≥ 100 ms EN cold_open_p1 zware-vector delta ≥ 50 ms

**Go/no-go beslissing:** [ ] GO  [ ] NO-GO

**Toelichting:**
