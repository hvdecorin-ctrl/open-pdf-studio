# PoC 03 implementatieplan

## Vooraf

- Branch: `poc/03-axis-aligned-draw-pixmap` vanaf main HEAD (niet vanaf poc/01 of poc/02 branch)
- Eerst baseline meting: zie `pocs/shared/measure-baseline.mjs`
- Lees `open-pdf-render/src/renderer.rs` L406–471 voor het volledige beeld van het huidige draw_image pad

## Stappen

- [ ] Stap 1: Baseline meten
  Bestand: n.v.t. (bench run)
  Verwacht resultaat: cold_open_p1 barn ≈ 670 ms; cold_open_p1 tekst ≈ 80 ms

- [ ] Stap 2: Voeg een helper-functie toe om de axis-aligned + integer-pixel conditie te detecteren
  Bestand: `open-pdf-render/src/renderer.rs` (nieuw, vóór `draw_image` L406)
  Actie: schrijf `fn is_axis_aligned_integer(xform: &Transform) -> bool` die controleert:
    - `xform.kx.abs() < 1e-3` (geen shear in x)
    - `xform.ky.abs() < 1e-3` (geen shear in y)
    - `(xform.tx - xform.tx.round()).abs() < 0.5` (tx binnen 0.5 pixel van integer)
    - `(xform.ty - xform.ty.round()).abs() < 0.5` (ty binnen 0.5 pixel van integer)
  Verwacht resultaat: pure functie, geen side effects, compileert

- [ ] Stap 3: Meet welk percentage van BARN's image draws als axis-aligned geclassificeerd wordt
  Bestand: `open-pdf-render/src/renderer.rs` L406 — tijdelijk `eprintln!` in `draw_image` om de CTM te loggen
  Actie: run `cargo run --release --example barn_deep_dive` met de log actief; tel axis-aligned vs niet
  Verwacht resultaat: ≥ 70% van de image draws is axis-aligned (anders is de verwachte impact te klein)

- [ ] Stap 4: Voeg het snelle pad toe in `draw_image` vóór het Pattern-pad
  Bestand: `open-pdf-render/src/renderer.rs` L419 (na de `final_xform` berekening, vóór de `pad`-definitie L433)
  Actie:
  ```
  if is_axis_aligned_integer(final_xform) {
      let paint = PixmapPaint {
          opacity: gs.effective_fill_alpha(),
          blend_mode: BlendMode::SourceOver,
          quality: FilterQuality::Nearest,
      };
      self.pixmap.draw_pixmap(0, 0, img, &paint, final_xform, gs.clip_path.as_ref());
      return;
  }
  ```
  Verwacht resultaat: compileert; axis-aligned images nemen het snelle pad; alle overige images nemen het ongewijzigde Pattern + fill_path pad

- [ ] Stap 5: Verwijder het tijdelijke debug-log uit stap 3
  Verwacht resultaat: geen debug output in release build

- [ ] Stap 6: `cargo build --release` draaien op `open-pdf-render`
  Verwacht resultaat: geen compile-fouten; geen nieuwe Clippy warnings

- [ ] Stap 7: Visuele regression-check
  Bestand: zie `docs/superpowers/plans/2026-05-08-render-regression-test.md` voor de juiste aanroep
  Actie: run de render-regressie-test op de BARN fixture en minstens Tekst.pdf; vergelijk pixel-output met de opgeslagen baseline
  Verwacht resultaat: geen diffs boven de bestaande tolerantie

- [ ] Stap 8: Post-implementatie meting
  Verwacht resultaat: cold_open_p1 barn ≤ 610 ms (≥ 60 ms winst op image-zware pages)

## Meet-protocol

```bash
# Voor (baseline)
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture zware-vector --scenario cold_open_p1

# Na (post-implementatie)
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture zware-vector --scenario cold_open_p1
```

## Resultaten-template

Vul in als `results.md` in deze folder:

| Fixture | Scenario | Voor (ms) | Na (ms) | Delta (ms) | Delta % |
|---------|----------|-----------|---------|------------|---------|
| barn | cold_open_p1 | | | | |
| barn | scroll_p1_to_p7 | | | | |
| tekst | cold_open_p1 | | | | |
| zware-vector | cold_open_p1 | | | | |

**% BARN image draws geclassificeerd als axis-aligned:** ___%

**Visuele regressie-check:** [ ] Geen diffs  [ ] Diffs gevonden (zie bijlage)

**Succescriterium:** cold_open_p1 barn Na ≤ 640 ms EN geen visuele regressies

**Go/no-go beslissing:** [ ] GO  [ ] NO-GO

**Toelichting:**
