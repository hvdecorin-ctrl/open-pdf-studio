# PoC 01 implementatieplan

## Vooraf

- Branch: `poc/01-font-registry-rwlock` vanaf main HEAD
- Eerst baseline meting: zie `pocs/shared/measure-baseline.mjs`
- Lees `docs/superpowers/barn-deep-dive.md` voor de volledige context voor je begint

## Stappen

- [ ] Stap 1: Baseline meten op scroll_p1_to_p7 + cold_open_p1
  Bestand: n.v.t. (bench run)
  Verwacht resultaat: scroll_p1_to_p7 barn ≈ 1200 ms; cold_open_p1 barn ≈ 670 ms

- [ ] Stap 2: Wijzig de import in `parser.rs` om RwLock te includen
  Bestand: `open-pdf-render/src/parser.rs` L1
  Actie: voeg `RwLock` toe aan de `use std::sync::{Arc, Mutex}` import (of vervang Mutex door RwLock voor de registry-field)
  Verwacht resultaat: compileert zonder warnings

- [ ] Stap 3: Wijzig het `font_registry`-veld in `DocumentHandle` van `Mutex<FontRegistry>` naar `RwLock<FontRegistry>`
  Bestand: `open-pdf-render/src/parser.rs` L70
  Actie: vervang `Mutex<FontRegistry>` door `RwLock<FontRegistry>`
  Verwacht resultaat: compiler geeft fouten op alle `.lock()` call sites — dit is de worklist voor stap 4

- [ ] Stap 4: Vervang `.lock()` door `.read()` op de render-paden (read-only font lookups)
  Bestand: `open-pdf-render/src/parser.rs` L177–180 (tile path) en L346–348 (render_page_internal path) en L843–845, L879–881, L898–900 (text-extract paden)
  Actie: `.lock().map_err(...)` → `.read().map_err(...)` op elk read-pad; pas de variabele-naam aan naar `font_registry_guard` om verwarring te vermijden
  Verwacht resultaat: compileert; alle `.lock()`-fouten opgelost

- [ ] Stap 5: Controleer of er write-paden zijn in `FontRegistry` die tijdens render worden aangeroepen
  Bestand: `open-pdf-render/src/parser.rs` (zoek op `font_registry.register` of equivalente mutatiecall in de code die achter `execute_with_image_limit` loopt)
  Actie: als write-paden gevonden worden, gebruik `.write()` op die specifieke call sites; als er geen zijn in het render-pad, gebruik dan `.read()` overal
  Verwacht resultaat: duidelijkheid of font-registratie alleen tijdens initialisatie plaatsvindt of ook tijdens render

- [ ] Stap 6: Vervang de constructor in `DocumentHandle::new` (L85) van `Mutex::new` naar `RwLock::new`
  Bestand: `open-pdf-render/src/parser.rs` L85
  Verwacht resultaat: compileert zonder fout

- [ ] Stap 7: `cargo build --release` draaien op `open-pdf-render`
  Verwacht resultaat: geen compile-fouten, geen nieuwe warnings

- [ ] Stap 8: Post-implementatie meting
  Bestand: n.v.t. (bench run)
  Verwacht resultaat: scroll_p1_to_p7 barn ≤ 500 ms

## Meet-protocol

```bash
# Voor (baseline)
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture nkd1a --scenario scroll_p1_to_p7

# Na (post-implementatie)
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture nkd1a --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
```

## Resultaten-template

Vul in als `results.md` in deze folder:

| Fixture | Scenario | Voor (ms) | Na (ms) | Delta (ms) | Delta % |
|---------|----------|-----------|---------|------------|---------|
| barn | scroll_p1_to_p7 | | | | |
| barn | cold_open_p1 | | | | |
| nkd1a | scroll_p1_to_p7 | | | | |
| tekst | cold_open_p1 | | | | |

**Succescriterium:** barn / scroll_p1_to_p7 Na ≤ 500 ms

**Go/no-go beslissing:** [ ] GO  [ ] NO-GO

**Toelichting:**
