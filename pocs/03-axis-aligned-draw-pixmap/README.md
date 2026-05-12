# PoC 03 — axis-aligned-draw-pixmap

## Hypothese

De `draw_image`-methode in `renderer.rs` L406 gebruikt altijd `Pattern + fill_path` voor alle image draws — ook wanneer de CTM puur scale + integer-pixel translatie is (geen rotatie, geen skew, geen sub-pixel offset); voor die meerderheid van axis-aligned draws op BARN is `pixmap.draw_pixmap` met `FilterQuality::Nearest` 3–4× sneller, wat 30–50% reductie geeft in `draw_image`-tijd (~40–60 ms besparing per image-zware page).

## Rationale

De root cause is concreet gedocumenteerd in `docs/superpowers/barn-deep-dive.md`, sectie "Smoking gun", punt 1:

> "The Pattern + `fill_path` route was chosen for edge-rounding parity with PyMuPDF (renderer.rs L433-461), but it's 3-4× slower than the simple `draw_pixmap` fallback path."

De code in `open-pdf-render/src/renderer.rs` L406–471 toont de twee paden expliciet: het primaire pad (L440–461) bouwt een `Pattern`-shader, construeert een expanded rect (`pad = 0.5` in source-pixel ruimte), en roept `fill_path` aan. Het fallback-pad (L463–469) gebruikt de directe `draw_pixmap` call. Het fallback-pad wordt alleen bereikt als `Rect::from_ltrb` faalt — in de praktijk nooit.

De motivatie voor het `Pattern + fill_path` pad is "edge-rounding parity met PyMuPDF": als de destination rect op een sub-pixel boundary valt, zorgt de expanded rect + `SpreadMode::Pad` dat ook de randrij pixels gevuld zijn. Dit is correct gedrag voor sub-pixel-landed images. Maar voor images waarvan de destination rect op integer-pixel boundaries valt én de CTM geen rotatie/skew heeft, is dit extra werk volledig onnodig — `draw_pixmap` levert identieke pixels.

BARN's profiling toont dat de `draw_image (tiny_skia)` tijd per page 28–190 ms is (zie de image-stage tabel in de deep-dive). Dit zijn pages met 10–73 image draws. Op een typische BARN page zijn de meeste images axis-aligned en op integer-pixel boundaries: het zijn CAD-gegenereerde scan-plaatjes die door AutoCAD op vaste rasterpunten worden geplaatst.

De detectie van axis-aligned + integer-pixel is O(1) per image draw: controleer dat de CTM's `kx` en `ky` (shear-componenten) nul zijn, en dat de translatie-componenten `tx` en `ty` integer waarden hebben (binnen een kleine epsilon).

## Failure modes

1. **Sub-pixel translatie is common op BARN.** Als AutoCAD images op `tx = 1823.7` plaatst (niet op een integer pixel), dan detecteert de axis-aligned check een sub-pixel translatie en valt de code terug naar het `Pattern + fill_path` pad. Als dit de meerderheid van BARN's images betreft, is de winst kleiner dan verwacht. Dit is empirisch te verifiëren door de CTM-waarden te loggen tijdens een render.

2. **Visuele regressie op edge-rows.** Het `draw_pixmap` pad met `FilterQuality::Nearest` produceert soms een ontbrekende randpixelrij op destination rects die bij half-pixel vallen — exact het probleem dat het bestaande `Pattern + fill_path` pad oplost (Tekst.pdf p2, footer, zie deep-dive). Als de axis-aligned detectie ten onrechte positief is (float-afrondingsfout in de epsilon-check), introduceert deze PoC een visuele regressie. Mitigatie: vergelijkingstest met de render-regression-test suite (`docs/superpowers/plans/2026-05-08-render-regression-test.md`).

3. **Scale-only CTM heeft toch sub-pixel translatie na rotatie-normalisatie.** Bij PDFs met page rotatie normaliseert `render_page_internal` de CTM (L336–342 in parser.rs). Na normalisatie kan een op-grid bronimage in device-space op sub-pixel belanden. De axis-aligned check moet de post-normalisatie CTM evalueren, niet de originele PDF CTM.

4. **`FilterQuality::Nearest` vs `Bilinear` zichtbaar verschil bij upscale.** Bij scale-factor > 2× is Nearest sampling zichtbaar korrelig vs Bilinear. Als de gebruiker inzoomt (scale 1.5 → 3.0), zijn axis-aligned images toch gebaat bij Bilinear. Mitigatie: gebruik `Nearest` alleen bij scale ≤ 2.0; gebruik `Bilinear draw_pixmap` (het huidige fallback-pad L464–469) bij hogere scale. Dit vermijdt de Pattern overhead maar behoudt de kwaliteit.

5. **tiny_skia `draw_pixmap` heeft ander clip-gedrag dan `fill_path`.** Het huidige `fill_path` pad respecteert `gs.clip_path` via de laatste parameter. `draw_pixmap` heeft ook een clip_path parameter (L469), maar de semantiek van clipping via Pattern-fill vs direct draw kan bij complexe clip paths subtiel verschillen. Verificatie vereist op PDFs met geclipte images (zoals forms met overflow:hidden-equivalent in PDF).

## Succescriterium

**Go** als `cold_open_p1` op fixture `barn` daalt met ≥ 30 ms (median over 5 runs) EN de render-regressie-test geen pixel-diff laat zien boven de bestaande tolerantie.

**No-go** als de daling kleiner is dan 15 ms, of als er visuele regressies optreden die de tolerantie van de regression-test overschrijden.

Controle: `cold_open_p1` op `tekst` mag niet veranderen (Tekst.pdf heeft weinig images — de change is dan effectief no-op, maar mag ook niet trager worden door de extra CTM-check).

## Verwachte effort

½ dag. De CTM-detectie is een paar regels; de complexiteit zit in het kiezen van de juiste epsilon voor de integer-check en de visuele verificatie.

## Risico

**Laag.** Het fallback-pad (`Pattern + fill_path`) blijft ongewijzigd aanwezig; de wijziging voegt alleen een sneller pad toe voor een subset van images. Elke regressie is direct terugdraaibaar door de axis-aligned check te verwijderen.

## Pre-existing context

- `docs/superpowers/barn-deep-dive.md` — image-stage tabel (`draw_image (tiny_skia)` 28–190 ms per page), aanbeveling sectie punt 1
- `open-pdf-render/src/renderer.rs` L406–471 (`draw_image` volledig, met het Pattern-pad en het bestaande draw_pixmap fallback-pad)
- `docs/superpowers/plans/2026-05-08-render-regression-test.md` — de regression-test pipeline die visuele regressies detecteert
- `parliament/index.html` — PoC 03 als onderdeel van parallelle "foundation fixes" fase (gelijktijdig met PoC 02)
