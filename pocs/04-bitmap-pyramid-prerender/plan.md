# PoC 04 implementatieplan

## Vooraf

- Branch: `poc/04-bitmap-pyramid-prerender` vanaf main HEAD
- **Pre-requisite:** PoC 01 (`poc/01-font-registry-rwlock`) moet GO zijn — zonder RwLock serialiseert de font_registry Mutex de parallel renders en is de prerender serieel i.p.v. parallel
- Eerst baseline meten: zie `pocs/shared/measure-baseline.mjs`
- Lees `open-pdf-render/src/parser.rs` L24–91 en L259–401 voor de bestaande cache-infra
- Lees `open-pdf-studio/js/pdf/renderer.js` L78–141 voor het bestaande `_schedulePreRenderAdjacent` patroon

## Pre-requisites

| PoC | Status vereist | Reden |
|-----|---------------|-------|
| PoC 01 font-registry-rwlock | GO | Zonder RwLock worden de parallelle prerender-threads geserialiseerd op de font_registry Mutex; prerender duurt dan 7× langer dan verwacht |

## Stappen

- [ ] Stap 1: Baseline meten op scroll_p1_to_p7 + cold_open_p1
  Bestand: n.v.t. (bench run)
  Verwacht resultaat: scroll_p1_to_p7 barn ≈ 4700 ms; cold_open_p1 barn ≈ 670 ms

- [ ] Stap 2: Voeg een nieuw Tauri command `prerender_pages` toe aan `src-tauri/src/lib.rs`
  Bestand: `open-pdf-studio/src-tauri/src/lib.rs`
  Actie: voeg toe:
  ```rust
  #[tauri::command]
  async fn prerender_pages(path: String, scale: f32, page_count: usize) -> Result<(), String> {
      // Laad doc uit cache, start rayon loop, schrijf naar pixmap_cache
  }
  ```
  Verwacht resultaat: command beschikbaar via `invoke('prerender_pages', {...})`

- [ ] Stap 3: Implementeer de rayon prerender-loop in `open-pdf-render/src/parser.rs`
  Bestand: `open-pdf-render/src/parser.rs` (nieuwe methode op `DocumentHandle`, na L939)
  Actie: voeg toe:
  ```rust
  pub fn prerender_all_pages(&self, scale: f32, max_pages: usize) {
      use rayon::prelude::*;
      let n = self.page_count().min(max_pages);
      (0..n).into_par_iter().for_each(|i| {
          // Check eerst of de cache-key al aanwezig is (vermijd dubbele render)
          let key = PageCacheKey { page_idx: i, scale_q: (scale * 10_000.0).round() as u32, rotation: 0 };
          if let Ok(cache) = self.pixmap_cache.lock() {
              if cache.map.contains_key(&key) { return; }
          }
          let _ = self.render_page_internal(i, scale, 0, 0);
      });
  }
  ```
  Noot: `pixmap_cache` is `Mutex<PageBitmapCache>` (parser.rs L76); `render_page_internal` schrijft zelf naar de cache (L391–398). De Mutex-lock in `render_page_internal` bij cache-insert is kort (alleen de insert, niet de render zelf).
  Verwacht resultaat: alle pages gerenderd en gecached na aanroep

- [ ] Stap 4: Begrens de prerender tot `min(page_count, 20)` om memory-explosie bij grote docs te voorkomen
  Bestand: `open-pdf-render/src/parser.rs` (in `prerender_all_pages`, de `max_pages` parameter)
  Actie: call sites geven `20` door als `max_pages`; de methode gebruikt `self.page_count().min(max_pages)`
  Verwacht resultaat: bij 200-page PDF worden alleen pages 0–19 ge-prerenderd

- [ ] Stap 5: Roep `prerender_pages` aan vanuit JS na de eerste page render
  Bestand: `open-pdf-studio/js/pdf/renderer.js` (in `renderPage`, na de cache-insert op L569–585)
  Actie: voeg toe na `_schedulePreRenderAdjacent(doc, pageNum, scale)` op L585:
  ```js
  if (pageNum === 1 && doc.filePath && isTauri()) {
      const dpr = getCanvasDPR();
      invoke('prerender_pages', {
          path: doc.filePath,
          scale: scale * dpr,
          pageCount: doc.pdfDoc?.numPages || 1,
      }).catch(e => console.warn('[prerender] background prerender failed:', e));
  }
  ```
  Verwacht resultaat: prerender start zodra page 1 klaar is, in de achtergrond, zonder `await`

- [ ] Stap 6: Controleer dat de foreground render van page 2 niet wordt vertraagd
  Bestand: n.v.t. (profiling)
  Actie: open BARN, navigeer meteen naar page 2 vóór de prerender klaar is; meet de render-tijd
  Verwacht resultaat: page 2 foreground render ≤ 720 ms (≤ 7% vertraging t.o.v. baseline door CPU-contentie)

- [ ] Stap 7: Log het memory-gebruik na volledige prerender van BARN
  Bestand: `open-pdf-render/src/parser.rs` (tijdelijk debug-log in `prerender_all_pages` na voltooiing)
  Actie: log aantal entries en totale RGBA-grootte via `eprintln!`
  Verwacht resultaat: 7 entries, ~210 MB totaal bij scale 1.0 DPR 1.0

- [ ] Stap 8: `cargo build --release` draaien op `open-pdf-render` en `open-pdf-studio/src-tauri`
  Verwacht resultaat: geen compile-fouten; geen nieuwe Clippy warnings over par_iter of Mutex

- [ ] Stap 9: Post-implementatie meting — wacht 2 s na document-open voor bench-run (geeft prerender tijd)
  Verwacht resultaat: scroll_p1_to_p7 barn ≤ 500 ms

## Meet-protocol

```bash
# Voor (baseline)
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1

# Na (post-implementatie) — met 2 s settle-tijd na open
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7 --settle 2000
node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_back_revisit
node pocs/shared/bench-harness.mjs --fixture tekst --scenario cold_open_p1
node pocs/shared/bench-harness.mjs --fixture nkd1a --scenario scroll_p1_to_p7 --settle 2000
```

## Resultaten-template

Vul in als `results.md` in deze folder:

| Fixture | Scenario | Voor (ms) | Na (ms) | Delta (ms) | Delta % |
|---------|----------|-----------|---------|------------|---------|
| barn | scroll_p1_to_p7 (warm prerender) | | | | |
| barn | cold_open_p1 | | | | |
| barn | scroll_back_revisit | | | | |
| tekst | cold_open_p1 | | | | |
| nkd1a | scroll_p1_to_p7 (warm prerender) | | | | |

**Memory na prerender barn:** ___ entries, ___ MB RGBA totaal

**Vertraging foreground render page 2 door CPU-contentie:** ___ ms (baseline: ___ ms)

**Succescriterium:** scroll_p1_to_p7 barn Na ≤ 500 ms EN cold_open_p1 barn stijging ≤ 10%

**Go/no-go beslissing:** [ ] GO  [ ] NO-GO

**Toelichting:**
