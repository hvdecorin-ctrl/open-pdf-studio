# PoC 02 implementatieplan

## Vooraf

- Branch: `poc/02-doc-image-cache` vanaf main HEAD (niet vanaf poc/01 branch)
- Eerst baseline meting: zie `pocs/shared/measure-baseline.mjs`
- Lees `open-pdf-render/src/interpreter.rs` L183–254 en L827–910 voor het volledige beeld van de huidige cache-lifecycle

## Stappen

- [ ] Stap 1: Baseline meten
  Bestand: n.v.t. (bench run)
  Verwacht resultaat: scroll_p1_to_p7 barn ≈ 1200 ms; cold_open_p1 barn ≈ 670 ms; scroll_back_revisit barn ≈ 50 ms (pixmap LRU cache warm)

- [ ] Stap 2: Voeg een doc-scoped image cache toe aan `DocumentHandle`
  Bestand: `open-pdf-render/src/parser.rs` L68–89
  Actie: voeg een veld toe `doc_image_cache: Arc<RwLock<ImageCache>>` (importeer `RwLock` als dat er niet al is); initialiseer in `DocumentHandle::new` als lege HashMap
  Verwacht resultaat: compileert; `ImageCache` type is al beschikbaar via `crate::interpreter::ImageCache`

- [ ] Stap 3: Geef de doc-image-cache mee aan `execute_with_image_limit` via een extra parameter
  Bestand: `open-pdf-render/src/interpreter.rs` L216 (functiesignatuur `execute_with_image_limit`)
  Actie: voeg parameter `doc_image_cache: Option<Arc<RwLock<ImageCache>>>` toe; propageer naar `execute_internal` L228
  Verwacht resultaat: compiler geeft fouten op alle call sites — de worklist voor stap 4

- [ ] Stap 4: Pas de call sites in parser.rs aan om de doc-image-cache mee te geven
  Bestand: `open-pdf-render/src/parser.rs` L193, L359 (en eventuele andere `execute_with_image_limit` calls)
  Actie: geef `Some(Arc::clone(&self.doc_image_cache))` mee
  Verwacht resultaat: compileert

- [ ] Stap 5: Implementeer de merge-logica in `execute_internal`
  Bestand: `open-pdf-render/src/interpreter.rs` L240–254
  Actie: na constructie van de lokale `img_cache` in L240, merge de doc_image_cache entries in de lokale cache (read-lock, clone Arc handles voor alle entries). Na de render, merge de nieuwe lokale entries terug naar de doc_image_cache (write-lock, insert_if_absent semantics — nooit overschrijven om thundering herd te vermijden).
  Verwacht resultaat: eerste render van page 1 vult de doc cache; render van page 2 start met gedeelde entries al aanwezig

- [ ] Stap 6: Valideer dat `predecode_images_parallel` geen dubbel werk doet voor al-gecachede images
  Bestand: `open-pdf-render/src/interpreter.rs` L827–910 (`predecode_images_parallel`)
  Actie: voeg een check toe vóór de decode-loop: sla XObjects over waarvan de ID al in de doc-cache zit (check via read-lock)
  Verwacht resultaat: pages 2–7 overslaan het parallel decode werk voor gedeelde images

- [ ] Stap 7: `cargo build --release` draaien op `open-pdf-render`
  Verwacht resultaat: geen compile-fouten; geen nieuwe Clippy warnings over Arc-clones

- [ ] Stap 8: Geheugen-check — log het aantal entries in de doc-cache na render van alle 7 BARN pages
  Bestand: `open-pdf-render/src/parser.rs` (tijdelijk debug-log)
  Verwacht resultaat: < 200 unieke entries; totale RGBA-grootte < 100 MB voor BARN bij scale 1.0

- [ ] Stap 9: Post-implementatie meting
  Verwacht resultaat: scroll_p1_to_p7 barn ≤ 1050 ms; scroll_back_revisit onveranderd (± 5%)

## Meet-protocol

```bash
# Voor (baseline)
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_back_revisit

# Na (post-implementatie)
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_back_revisit
node pocs/shared/bench-harness.mjs --fixture nkd1a --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
```

## Resultaten-template

Vul in als `results.md` in deze folder:

| Fixture | Scenario | Voor (ms) | Na (ms) | Delta (ms) | Delta % |
|---------|----------|-----------|---------|------------|---------|
| barn | scroll_p1_to_p7 | | | | |
| barn | cold_open_p1 | | | | |
| barn | scroll_back_revisit | | | | |
| nkd1a | scroll_p1_to_p7 | | | | |
| tekst | cold_open_p1 | | | | |

**Geheugengebruik doc_image_cache na 7 pages BARN:** ___ entries, ___ MB RGBA totaal

**Succescriterium:** scroll_p1_to_p7 barn Na ≤ 1050 ms OF cold_open_p1 pages 2–7 individueel ≥ 30 ms lager

**Go/no-go beslissing:** [ ] GO  [ ] NO-GO

**Toelichting:**
