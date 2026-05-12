# PoC 02 — doc-image-cache

## Hypothese

Het per-render `img_cache: ImageCache` in `interpreter.rs` L240 leeft alleen voor de duur van één page render; door de decoded RGBA buffers te verplaatsen naar een doc-scoped `Arc<RwLock<ImageCache>>` op `DocumentHandle` worden images die op meerdere pages van dezelfde PDF voorkomen (zoals BARN's north arrow en legenda-elementen) slechts éénmaal gedecodeerd over alle renders samen, wat 52 ms per page bespaart op pages 2+ waar dezelfde XObjects terugkeren.

## Rationale

De profilingdata in `docs/superpowers/barn-deep-dive.md` toont dat `predecode_parallel` gemiddeld 52 ms/page kost (range: 4 ms op p4 tot 102 ms op p3). De huidige `ImageCache` (type alias in `interpreter.rs` L196: `HashMap<lopdf::ObjectId, CachedDecodedImage>`) wordt aangemaakt in `execute_internal` L240 en gedropped aan het einde van diezelfde functie. De Arc<Vec<u8>> buffers worden bij elke nieuwe render opnieuw gealloceerd en ingevuld.

BARN's deep-dive toont dat p1 62 image refs heeft bij 48 unieke images (max reuse factor 6), p6 heeft 73 refs bij 16 uniek (max reuse factor 33). Dit zijn within-page reuses die de bestaande cache al vangt. De cross-page winst zit in images die op meerdere pages voorkomen — zoals een north arrow, een legenda-blok of een standaard koptekst. Bij BARN is dat aantoonbaar aanwezig (de legenda is identiek op elke pagina).

De `CachedDecodedImage` struct bevat al een `Arc<Vec<u8>>` voor de RGBA-data (L803–804 in interpreter.rs), dus de deelingstechniek is al aanwezig; alleen de cache-scope is te beperkt.

## Failure modes

1. **Cross-page winst is kleiner dan verwacht.** Als BARN's gedeelde images (north arrow, legenda) bij de `predecode_parallel`-pass al goedkoop zijn omdat ze klein zijn (lage pixel count = snelle decode), is de absolute tijdwinst marginaal. De 52 ms/page gemiddelde is scheef verdeeld: p4 scoort slechts 4 ms. Als de gemeenschappelijke images toevallig op de goedkope pages zitten, is de cross-page hit minimaal.

2. **Thread-safety complexiteit.** Een `Arc<RwLock<ImageCache>>` die concurrent door meerdere renders wordt geschreven, vraagt zorgvuldige locking. Twee renders die tegelijk page 1 en page 2 starten kunnen beiden een cache miss registreren op hetzelfde XObject en beiden beginnen te decoderen — klassiek "thundering herd" probleem. Mitigatie: een twee-fase lookup (check → decode → insert) of een `DashMap` voor lock-free concurrent inserts.

3. **Geheugendruk bij grote PDFs.** Een doc-scoped cache bewaart alle decoded images voor de levensduur van het document, niet alleen voor de duur van één render. BARN heeft 73 images per page × 7 pages = potentieel honderden MB RGBA data in geheugen. De bestaande per-render cache laat dit geheugen vrij zodra de render klaar is. Met een doc-scoped cache kan dit de totale geheugengebruik significant verhogen bij grote PDFs met veel unieke images.

4. **De pixmap-LRU cache omzeilt het probleem al deels.** De doc-level `PageBitmapCache` (parser.rs L76) cached de volledige gerenderde pixmap per `(page_id, scale, rotation)`. Als een gebruiker dezelfde page opnieuw bezoekt bij dezelfde schaal, is het complete resultaat gecached en wordt `execute_internal` niet eens aangeroepen. De doc-image-cache helpt alleen bij cold renders van pages die shared images bevatten — een scenario dat al deels beperkt is door de pixmap-LRU.

5. **XObject ID-collisies bij meerdere open documenten.** Als `DocumentHandle` ooit wordt uitgebreid om meerdere PDFs te beheren (bijv. tabbladen), moeten `ObjectId`s worden gekoppeld aan hun bron-PDF. Lopdf's `ObjectId` is een `(u32, u16)` tuple zonder doc-context, dus een naïeve cache zou cross-doc collisies geven.

## Succescriterium

**Go** als `cold_open_p1` op fixture `barn` daalt met ≥ 30 ms op pages 2–7 (median), OF als `scroll_p1_to_p7` daalt met ≥ 150 ms totaal.

Verificatie: run `scroll_back_revisit` op `barn` — de warme pass (pages 1–7 tweede keer) moet 0 ms extra kosten voor image decode (volledig cache hit in de doc-cache).

**No-go** als de winst op `scroll_p1_to_p7` kleiner is dan 50 ms (< 4%) — de implementatiecomplexiteit is dan niet gerechtvaardigd.

## Verwachte effort

1 dag. De cache-structuur zelf is klein, maar de thread-safety correctheid (insert-once semantics, geen dubbele decode bij concurrent miss) vraagt een zorgvuldige review.

## Risico

**Laag.** De `Arc<Vec<u8>>` semantiek is al aanwezig in `CachedDecodedImage`. De RwLock-wrapper is mechanisch. Geheugendruk is het grootste echte risico en is meetbaar; als het geheugengebruik meer dan 200 MB stijgt voor BARN, is de cache te agressief en moet een LRU-evictie worden toegevoegd.

## Pre-existing context

- `docs/superpowers/barn-deep-dive.md` — image-stage detail tabel: `predecode_parallel` gemiddeld 52 ms, max reuse p6 = 33
- `open-pdf-render/src/interpreter.rs` L183–196 (`CachedDecodedImage` struct + `ImageCache` type), L239–254 (per-render cache constructie + predecode_parallel aanroep), L760–815 (`handle_image_execute` met cache lookup)
- `open-pdf-render/src/parser.rs` L76–89 (`pixmap_cache` als voorbeeld van doc-scoped cache met Mutex)
- `parliament/index.html` — PoC 02 als onderdeel van de parallelle "foundation fixes" fase
