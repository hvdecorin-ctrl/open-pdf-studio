# PoC 01 — font-registry-rwlock

## Hypothese

De `font_registry` Mutex in `DocumentHandle` wordt voor de volledige duur van `serial_walk` (100–600 ms per page) vastgehouden, waardoor parallelle page renders op het Tauri threadpool volledig serialiseren; vervangen door een `RwLock` laat meerdere renders tegelijk hun font lookups doen en maakt scroll van 3 pages tegelijk 2–3× sneller.

## Rationale

De root cause is gedocumenteerd in `docs/superpowers/barn-deep-dive.md` (commit `937e0c46`), sectie "Why the user perceives 'factor 100'", punt 2:

> "They ALL try to lock the same `font_registry` Mutex. Wall-time observed by the user becomes (page1_cold + page2_cold + page3_cold) sequenced, not parallelised."

Concreet: in `open-pdf-render/src/parser.rs` L177–215 (tilerender path) en L346–381 (render_page_internal path) wordt de lock via `.lock()` verkregen voor de volledige duur van `execute_with_image_limit` plus `render_page_annotations`. De `font_registry` Mutex in `DocumentHandle` (L70) is een standaard `std::sync::Mutex`.

De tokio threadpool van Tauri voert `render_pdf_page` commands concurrent uit. Wanneer de IntersectionObserver 3 pages binnen ~100 ms aanmeldt, starten 3 parallelle Tauri commands — maar slechts één kan de Mutex vasthouden. De andere twee blokkeren volledig. Wallclock voor 3 pages = page1 + page2 + page3 in serie = ~1.2 s (3 × 400 ms) in plaats van ~400 ms (parallel).

`FontRegistry` heeft geen mutable state tijdens normale renders: fonts worden bij eerste gebruik ingeladen (write) en daarna alleen nog gelezen (lookup). Een `RwLock` geeft meerdere gelijktijdige lezers, met een exclusieve write-lock alleen bij eerste font-registratie.

## Failure modes

1. **Deadlock bij font-registratie tijdens render.** Als `execute_with_image_limit` intern een write naar de registry doet terwijl dezelfde thread al een read-lock houdt (via recursive lock paths), treedt deadlock op. `std::sync::RwLock` is niet reentrant. Mitigatie: verificeer dat alle write-paden naar `FontRegistry` uitsluitend vanuit `render_page_internal` vóór de interpret-fase plaatsvinden (L346 vs L359).

2. **BARN heeft maar één uniek font per page.** Als BARN's font al bij page 0 geregistreerd is en pages 1–6 alleen read-locks nodig hebben, werkt de RwLock prima. Maar als het benchmark-effect klein is — pages 2–6 duren elk maar 150–260 ms — dan is de waargenomen winst kleiner dan voorspeld. De hypothese geldt vooral voor de `scroll_p1_to_p7` scenario, niet voor `cold_open_p1`.

3. **Tokio's scheduler serialiseert anyway.** Tauri's commandhandler gebruikt een tokio threadpool, maar als alle 3 commands op dezelfde worker-thread terechtkomen (bijv. door short-circuit scheduling op een 2-core VM), serialiseert de scheduling zelf de renders en levert de RwLock geen wallclock-winst op.

4. **`render_page_annotations` houdt de lock ook vast.** L213 en L379 in parser.rs roepen `render_page_annotations` aan terwijl de lock actief is. Als annotaties ook font-lookups doen, blijft de lock-hold tijd hoog. Met RwLock zijn meerdere annotatie-renders parallel, maar de totale lock-duur per page daalt niet.

5. **Poison-propagatie.** Bij `RwLock` kan een paniek in een read-lock de lock poisonen. De huidige `.lock().map_err(...)` foutafhandeling werkt, maar moet worden aangepast naar `.read().map_err(...)` en `.write().map_err(...)` met dezelfde error-string.

## Succescriterium

**Go** als `scroll_p1_to_p7` op fixture `barn` daalt van baseline 1200 ms naar ≤ 500 ms (median over 3 runs). Dit is de "3× faster" drempel uit de hypothese.

**No-go** als de daling kleiner is dan 20% (< 960 ms), wat aangeeft dat de Tauri scheduler of een andere bottleneck de parallelisatie verhindert.

Controle: `cold_open_p1` op `barn` mag niet meer dan 5% stijgen (RwLock heeft iets meer overhead dan Mutex bij uncontended access).

## Verwachte effort

½ dag.

## Risico

**Laag.** RwLock is een drop-in vervanging voor Mutex met identieke API voor het read-path. De change is beperkt tot 3 locaties in parser.rs. Geen logica-wijziging, geen algoritmische aanpassing. Veilig terug te reverten zonder functionele regressie.

## Pre-existing context

- `docs/superpowers/barn-deep-dive.md` — volledige profiling met "smoking gun" sectie en aanbeveling voor RwLock
- `parliament/index.html` — PoC 01 als eerste prioriteit ("bekende-en-niet-aangedane root cause")
- `pocs/README.md` — volgorde: "PoC 01 eerst"
- Relevante code: `open-pdf-render/src/parser.rs` L68–89 (DocumentHandle struct), L177–215 (tile path), L346–381 (render_page_internal path)
