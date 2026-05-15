# PDFium Renderer Swap + Opschoning Open PDF Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vervang de Rust + tiny-skia renderer in `open-pdf-render` door PDFium (via `pdfium-render`) voor cold-open snelheid vergelijkbaar met Edge/Chrome, en schoon alle dood/duplicate render-infrastructuur op die niet meer relevant is na de swap.

**Architecture:** Renderer-only swap (Scope A) — alleen `render_pdf_page` en `render_thumbnail` Tauri commands gaan over op PDFium; de vector-render path (`extract_draw_commands` → `vector-renderer.js`) blijft op `open-pdf-render`. PDFium DLL wordt meegebundeld in de Tauri installer via `bundle.resources`. PoC 02 (`doc_image_cache`) en PoC 04 (`pixmap_cache`) verdwijnen omdat PDFium snel genoeg is dat de bijbehorende complexiteit en geheugen-overhead niet langer gerechtvaardigd zijn.

**Tech Stack:** Tauri 2.10, Rust, `pdfium-render` 0.9.x, PDFium prebuilt Windows-x64 (~14 MB DLL), behoud van `lopdf` voor vector-path content-stream parsing, behoud van `image` crate voor thumbnail JPEG-encoding.

**Spec:** `docs/superpowers/specs/2026-05-15-pdfium-renderer-swap-design.md`

**Branch:** `feat/fast-open-barn`

**Geen release.** Niet mergen naar main, geen versie-bump, geen GitHub-release.

---

## Bestandsstructuur na implementatie

| Pad | Verantwoordelijkheid | Wijziging |
|-----|---------------------|-----------|
| `open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll` | PDFium prebuilt DLL voor Windows | **Nieuw** |
| `open-pdf-studio/src-tauri/binaries/win-x64/README.md` | Versie/checksum/license/provenance | **Nieuw** |
| `open-pdf-studio/src-tauri/src/pdfium_renderer.rs` | PDFium init, document-cache, render helpers | **Nieuw** |
| `open-pdf-studio/src-tauri/Cargo.toml` | `pdfium-render` dep, dev opt-level | **Gewijzigd** |
| `open-pdf-studio/src-tauri/tauri.conf.json` | `bundle.resources` voor DLL | **Gewijzigd** |
| `open-pdf-studio/src-tauri/src/lib.rs` | `render_pdf_page` + `render_thumbnail` body, PDFium init in `run()` | **Gewijzigd** |
| `open-pdf-studio/src-tauri/src/mcp_server.rs` | Migreert van `open_pdf_render::DocumentHandle::render_page` naar PDFium | **Gewijzigd** |
| `open-pdf-studio/src-tauri/src/render_to_png.rs` | Migreert naar PDFium | **Gewijzigd** |
| `open-pdf-render/Cargo.toml` | `tiny-skia`/`turbojpeg`/`image` deps weg | **Gewijzigd (fase 4)** |
| `open-pdf-render/src/parser.rs` | `render_page*` + `pixmap_cache` + `doc_image_cache` weg | **Gewijzigd (fase 4)** |
| `open-pdf-render/src/interpreter.rs` | Rendering paths weg, `extract_commands` path behouden | **Gewijzigd (fase 4)** |
| `open-pdf-render/src/lib.rs` | `pub mod renderer` weg | **Gewijzigd (fase 4)** |
| `open-pdf-render/src/renderer.rs` | (SkiaRenderer) | **Verwijderd (fase 4)** |
| `open-pdf-render/examples/*.rs` | Eenmalige debug examples | **Verwijderd (fase 1)** |
| `open-pdf-studio/js/text/rust-text-extraction.js` | Dead code | **Verwijderd (fase 1)** |
| `mcp-server/{bench-barn-perf,bench-ipc-overhead,diag-tile-render,test-symbols-cdp,test-tauri-cdp,test-zoom-pan,read-rotation-log}.mjs` | Eenmalige diagnose-scripts | **Verwijderd (fase 1)** |
| `mcp-server/{current-text.png, final-check.png, stamp-after-fix.jpg, stamp-final-check.jpg}` | Debug screenshots | **Verwijderd (fase 1)** |
| `_iter34_pymupdf_xref517.ttf`, `_iter34_pymupdf_xref522.pfa` | Debug font-extracts in repo-root | **Verwijderd (fase 1)** |
| `docs/superpowers/historical/poc-02-04-results.md` | Geconsolideerde archief van PoC 02 + 04 metingen | **Nieuw (fase 5)** |

---

## Fase 1 — Dead code opschonen

Geen functioneel risico. Verifieer alleen dat de app blijft bouwen en lopen.

### Task 1: Verwijder `rust-text-extraction.js` en `extract_text_spans*`

**Files:**
- Delete: `open-pdf-studio/js/text/rust-text-extraction.js`
- Modify: `open-pdf-render/src/parser.rs` (remove `extract_text_spans` + `extract_text_spans_batch` methods)
- Modify: `open-pdf-render/src/lib.rs` (remove `TextSpan` struct + `pub use` if any)
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (remove Tauri command if `extract_text_spans` is registered)

- [ ] **Step 1: Verifieer dat niets `rust-text-extraction.js` importeert**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
grep -rn "rust-text-extraction" open-pdf-studio/js/ 2>&1
```

Expected: alleen 1 hit op het bestand zelf, geen imports. Als er WEL imports zijn: STOP, melden bij user.

- [ ] **Step 2: Verifieer dat `TextSpan` of `extract_text_spans` niet vanuit JS gebruikt wordt**

```bash
grep -rn "extract_text_spans\|TextSpan\|extractTextSpans" open-pdf-studio/js/ open-pdf-studio/src-tauri/src/ 2>&1
```

Expected: hits alleen in `rust-text-extraction.js` (verwijderd in stap 3), `open-pdf-render/src/parser.rs`, en mogelijk een `From<TextSpan>` impl in `lib.rs:1410`.

- [ ] **Step 3: Verwijder het JS-bestand**

```bash
rm open-pdf-studio/js/text/rust-text-extraction.js
```

- [ ] **Step 4: Verwijder `extract_text_spans` + `extract_text_spans_batch` uit parser.rs**

Open `open-pdf-render/src/parser.rs`. Zoek de twee methoden (begint rond regel 748 en 791 — `pub fn extract_text_spans` en `pub fn extract_text_spans_batch`). Verwijder beide methoden volledig inclusief docstrings.

- [ ] **Step 5: Verwijder `TextSpan` struct en gerelateerde exports uit lib.rs**

Open `open-pdf-render/src/lib.rs`. Zoek `pub struct TextSpan` (rond regel 54-63) en verwijder de struct definitie. Verwijder ook `pub use crate::TextSpan` / `pub use` regels die ernaar verwijzen.

- [ ] **Step 6: Verwijder de `TextSpan` `From` impl en `extract_text_spans` Tauri command uit `src-tauri/src/lib.rs`**

```bash
grep -n "TextSpan\|extract_text_spans" open-pdf-studio/src-tauri/src/lib.rs
```

Verwijder elk hit-blok: de `From<open_pdf_render::TextSpan>` impl (rond regel 1410), eventuele Tauri command `fn extract_text_spans`, en de `.invoke_handler` registratie.

- [ ] **Step 7: Verifieer dat de Rust build slaagt**

```bash
cd open-pdf-render && cargo build --release 2>&1 | tail -5
cd ../open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: beide builds slagen zonder errors. Warnings over ongebruikte imports zijn OK.

- [ ] **Step 8: Verifieer dat de JS build slaagt**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio && npm run build 2>&1 | tail -10
```

Expected: vite build slaagt zonder errors.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-studio/js/text/rust-text-extraction.js open-pdf-render/src/parser.rs open-pdf-render/src/lib.rs open-pdf-studio/src-tauri/src/lib.rs
git commit -m "chore: remove unused extract_text_spans + rust-text-extraction.js

js/text/rust-text-extraction.js had no importers — dead code.
open-pdf-render::extract_text_spans + _batch + TextSpan struct
had no JS consumer. Same for the From<TextSpan> impl and Tauri
command in src-tauri/src/lib.rs.

No functional change."
```

---

### Task 2: Verwijder debug font-extracts uit repo-root

**Files:**
- Delete: `_iter34_pymupdf_xref517.ttf`
- Delete: `_iter34_pymupdf_xref522.pfa`

- [ ] **Step 1: Bevestig de bestanden bestaan**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
ls -la _iter34_pymupdf_xref*.ttf _iter34_pymupdf_xref*.pfa 2>&1
```

Expected: 2 bestanden gelijst.

- [ ] **Step 2: Verifieer dat ze nergens geïmporteerd worden**

```bash
grep -rn "_iter34_pymupdf" open-pdf-studio/ open-pdf-render/ docs/ 2>&1 | head
```

Expected: 0 hits (anders STOP en melden).

- [ ] **Step 3: Verwijder de bestanden**

```bash
rm _iter34_pymupdf_xref517.ttf _iter34_pymupdf_xref522.pfa
```

- [ ] **Step 4: Commit**

```bash
git add -u _iter34_pymupdf_xref517.ttf _iter34_pymupdf_xref522.pfa
git commit -m "chore: remove debug font-extract files from repo root

Both files were one-shot PyMuPDF font diffing artifacts during
iter-34 work. Not referenced anywhere."
```

---

### Task 3: Verwijder mcp-server diagnose-scripts en debug-images

**Files:**
- Delete: `mcp-server/bench-barn-perf.mjs`
- Delete: `mcp-server/bench-ipc-overhead.mjs`
- Delete: `mcp-server/diag-tile-render.mjs`
- Delete: `mcp-server/test-symbols-cdp.mjs`
- Delete: `mcp-server/test-tauri-cdp.mjs`
- Delete: `mcp-server/test-zoom-pan.mjs`
- Delete: `mcp-server/read-rotation-log.mjs`
- Delete: `mcp-server/current-text.png`
- Delete: `mcp-server/final-check.png`
- Delete: `mcp-server/stamp-after-fix.jpg`
- Delete: `mcp-server/stamp-final-check.jpg`
- **Bewaar:** `mcp-server/check-app-state.mjs` (algemene MCP debug-tool)

- [ ] **Step 1: Bevestig dat geen van de te verwijderen scripts wordt geïmporteerd elders**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
for f in bench-barn-perf bench-ipc-overhead diag-tile-render test-symbols-cdp test-tauri-cdp test-zoom-pan read-rotation-log; do
  echo "=== $f ==="
  grep -rn "$f" --include="*.{js,mjs,json,md}" -l 2>&1 | head
done
```

Expected: alleen hits binnen `mcp-server/` zelf, geen imports van buitenaf.

- [ ] **Step 2: Verwijder de bestanden**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio/mcp-server
rm bench-barn-perf.mjs bench-ipc-overhead.mjs diag-tile-render.mjs test-symbols-cdp.mjs test-tauri-cdp.mjs test-zoom-pan.mjs read-rotation-log.mjs current-text.png final-check.png stamp-after-fix.jpg stamp-final-check.jpg
```

- [ ] **Step 3: Verifieer dat check-app-state.mjs nog werkt**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
ls mcp-server/
```

Expected: minstens `check-app-state.mjs` en eventuele README/node_modules nog aanwezig.

- [ ] **Step 4: Commit**

```bash
git add -u mcp-server/
git commit -m "chore: remove one-shot mcp-server diagnostic scripts

bench-barn-perf, bench-ipc-overhead, diag-tile-render and 4 other
test/debug .mjs files were created during specific debugging sessions
(iter-32/iter-33/PoC work) and have no ongoing role.

The 4 debug PNG/JPG screenshots in mcp-server/ were artifacts of
those same sessions.

check-app-state.mjs is preserved as a general-purpose CDP probe."
```

---

### Task 4: Verwijder `open-pdf-render/examples/` directory

**Files:**
- Delete: `open-pdf-render/examples/barn_deep_dive.rs`
- Delete: `open-pdf-render/examples/probe_type1.rs`
- Delete: `open-pdf-render/examples/profile_image_stages.rs`
- Delete: `open-pdf-render/examples/profile_render.rs`
- Delete: `open-pdf-render/examples/render_page_literal.rs`
- Delete: `open-pdf-render/examples/inspect_page.rs`

- [ ] **Step 1: Verifieer dat de examples niet door tests of CI worden gebruikt**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
grep -rn "examples/barn_deep_dive\|examples/profile_render\|examples/inspect_page" --include="*.{toml,yaml,yml,sh,bat,md,rs}" 2>&1 | head
```

Expected: 0 hits (anders melden).

- [ ] **Step 2: Verwijder de examples directory**

```bash
rm -rf open-pdf-render/examples
```

- [ ] **Step 3: Verifieer cargo build slaagt zonder examples**

```bash
cd open-pdf-render && cargo build --release 2>&1 | tail -5
```

Expected: build slaagt.

- [ ] **Step 4: Commit**

```bash
cd ..
git add -u open-pdf-render/examples
git commit -m "chore: remove one-shot example binaries from open-pdf-render

barn_deep_dive.rs, probe_type1.rs, profile_image_stages.rs,
profile_render.rs, render_page_literal.rs, inspect_page.rs were
all created during specific debugging or profiling sessions. None
have an ongoing role in the build or tests."
```

---

## Fase 2 — PDFium-integratie additief toevoegen

Voeg PDFium toe naast de bestaande renderer. Tot fase 3 verandert er niets aan het runtime-gedrag.

### Task 5: Maak `binaries/win-x64/` directory en download `pdfium.dll`

**Files:**
- Create: `open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll` (~14 MB binary)
- Create: `open-pdf-studio/src-tauri/binaries/win-x64/README.md`

- [ ] **Step 1: Maak de directory**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
mkdir -p open-pdf-studio/src-tauri/binaries/win-x64
```

- [ ] **Step 2: Download de PDFium DLL van bblanchon's release**

Voor reproduceerbaarheid pinnen we op release `chromium/7186` (juni 2025, brede compatibiliteit). Als deze release niet meer beschikbaar is, vervang door de meest recente met dezelfde structuur en update de README accordingly.

```bash
cd open-pdf-studio/src-tauri/binaries/win-x64
curl -L -o pdfium-windows-x64.tgz \
  https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F7186/pdfium-win-x64.tgz

# Extract de DLL en LICENSE (binnen bin/pdfium.dll en LICENSE in de tar)
tar -xzf pdfium-windows-x64.tgz bin/pdfium.dll LICENSE
mv bin/pdfium.dll .
rmdir bin
rm pdfium-windows-x64.tgz
ls -la pdfium.dll
```

Expected: `pdfium.dll` van ongeveer 14 MB, plus `LICENSE` (BSD-3-Clause).

- [ ] **Step 3: Bereken SHA-256 voor provenance**

```bash
sha256sum pdfium.dll
```

Noteer de hash voor de README in stap 4.

- [ ] **Step 4: Maak `README.md` met versie + checksum + license**

```bash
cat > README.md <<'EOF'
# PDFium prebuilt binaries — Windows x64

## Provenance

- **Source:** https://github.com/bblanchon/pdfium-binaries
- **Release:** `chromium/7186`
- **Download URL:** https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F7186/pdfium-win-x64.tgz
- **Date pulled:** 2026-05-15

## Files

- `pdfium.dll` — PDFium DLL, dynamically linked at runtime by `pdfium-render`.
- `LICENSE` — BSD-3-Clause license from Google's PDFium project.

## SHA-256

```
<vul hier de hash uit Step 3 in>  pdfium.dll
```

## Hoe te updaten

1. Vind een recentere release op https://github.com/bblanchon/pdfium-binaries/releases
2. Download `pdfium-win-x64.tgz` en pak `bin/pdfium.dll` + `LICENSE` uit
3. Vervang de bestanden in deze directory
4. Update versie + datum + SHA-256 in deze README
5. Test met `cargo run --bin open-pdf-studio` dat de app nog start

## License

PDFium zelf is BSD-3-Clause (zie `LICENSE`). De Open PDF Studio app is MIT.
Beide licenses zijn compatibel; voeg de BSD-3 attributie toe aan de
"About"-dialog van de app (tijdens release-prep, niet in deze test-branch).
EOF
```

Vul de SHA-256 hash uit Step 3 handmatig in op de plek van `<vul hier de hash uit Step 3 in>`.

- [ ] **Step 5: Verifieer dat de bestanden er staan**

```bash
ls -la open-pdf-studio/src-tauri/binaries/win-x64/
```

Expected: `pdfium.dll` (~14 MB), `LICENSE`, `README.md`.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-studio/src-tauri/binaries/
git commit -m "feat: add PDFium prebuilt DLL for Windows x64

pdfium.dll v chromium/7186 from bblanchon/pdfium-binaries.
~14 MB binary blob. Will be bundled into the Tauri installer via
bundle.resources in a follow-up task.

License: BSD-3-Clause (Google) — preserved alongside as LICENSE.
SHA-256 captured in binaries/win-x64/README.md for provenance."
```

---

### Task 6: Voeg `pdfium-render` toe aan `src-tauri/Cargo.toml`

**Files:**
- Modify: `open-pdf-studio/src-tauri/Cargo.toml` (regel 41 — `image` dep)

- [ ] **Step 1: Voeg de dependency toe**

Open `open-pdf-studio/src-tauri/Cargo.toml`. Direct na de regel `image = { version = "0.25", ... }` (regel 40), voeg toe:

```toml
pdfium-render = { version = "0.9", default-features = false, features = ["sync", "image"] }
```

Toelichting:
- `default-features = false` om de optionale `bindings` feature uit te schakelen
- `sync` voor `Send + Sync` ondersteuning (PDFium is single-threaded; deze feature voegt een mutex toe zodat multiple Tauri-command-threads veilig kunnen aanroepen)
- `image` zodat we PDFium-bitmaps direct kunnen converteren naar `image::DynamicImage` voor de thumbnail JPEG-encoding

- [ ] **Step 2: Voeg dev opt-level toe voor pdfium-render**

In het `[profile.dev.package.*]` blok onderaan `Cargo.toml`, voeg toe na de bestaande entries:

```toml
[profile.dev.package.pdfium-render]
opt-level = 3
```

- [ ] **Step 3: Verifieer dat cargo de dependency kan resolven**

```bash
cd open-pdf-studio/src-tauri
cargo fetch 2>&1 | tail -10
```

Expected: dependencies worden gedownload zonder versie-conflicten.

- [ ] **Step 4: Verifieer dat cargo build slaagt**

```bash
cargo build 2>&1 | tail -10
```

Expected: build slaagt. Bij linker-errors die de PDFium DLL nodig hebben: dat is verwacht en wordt in Task 9 opgelost door dynamic binding.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/Cargo.lock
git commit -m "feat: add pdfium-render crate dependency

pdfium-render v0.9 with sync (Send+Sync mutex wrapper) and image
(direct image::DynamicImage conversion) features. Default-features
disabled so we don't pull in bundled bindings.

DLL loading is done dynamically at runtime in lib.rs run() — no
static link, so no linker dependency on pdfium.dll during build."
```

---

### Task 7: Configureer Tauri `bundle.resources` voor de PDFium DLL

**Files:**
- Modify: `open-pdf-studio/src-tauri/tauri.conf.json`

- [ ] **Step 1: Voeg `resources` toe aan het `bundle` blok**

Open `open-pdf-studio/src-tauri/tauri.conf.json`. Het `bundle` blok begint rond regel 35. Direct na de `targets` array (eindigt op regel 42) en vóór `createUpdaterArtifacts`, voeg toe:

```json
    "resources": {
      "binaries/win-x64/pdfium.dll": "pdfium.dll"
    },
```

Hierdoor wordt `pdfium.dll` gekopieerd naar de root van de geïnstalleerde app (naast `open-pdf-studio.exe`).

Toelichting: `resources` als object met `src: dest` mapping. De Tauri bundler kopieert tijdens een release-build de DLL naar het installer-payload. Voor dev (cargo run) moeten we de DLL handmatig op de juiste plek hebben — dat regelen we in Task 9 via `Pdfium::bind_to_library`.

- [ ] **Step 2: Verifieer JSON syntax**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio
node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json'))" && echo "JSON OK"
```

Expected: `JSON OK`.

- [ ] **Step 3: Voor de dev-flow, kopieer de DLL naar de target-directory**

In dev gebruikt Tauri `target/debug/open-pdf-studio.exe`. De DLL moet daar ook staan, anders faalt `bind_to_library` bij `cargo run`.

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
mkdir -p open-pdf-studio/src-tauri/target/debug
cp open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll open-pdf-studio/src-tauri/target/debug/
```

Voor herhaalbaarheid: voeg een note toe aan de README van de binaries directory:

```bash
cat >> open-pdf-studio/src-tauri/binaries/win-x64/README.md <<'EOF'

## Dev workflow

Voor `cargo run` / `npm run tauri:dev` moet `pdfium.dll` in
`open-pdf-studio/src-tauri/target/debug/` of `target/release/`
staan. De build-flow doet dat niet automatisch (Tauri's
`bundle.resources` werkt alleen tijdens `cargo tauri build`).

Eenvoudige workaround: kopieer de DLL handmatig na een fresh checkout:

```bash
cp open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll \
   open-pdf-studio/src-tauri/target/debug/
```

Een `build.rs` die dit automatisch doet kan in een latere refactor toegevoegd worden.
EOF
```

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/src-tauri/tauri.conf.json open-pdf-studio/src-tauri/binaries/win-x64/README.md
git commit -m "build: bundle PDFium DLL via Tauri resources

Adds bundle.resources entry that copies pdfium.dll next to the
installed exe during 'cargo tauri build'. Dev-mode users must copy
the DLL to target/debug/ manually until a build.rs is added.

README of the binaries directory updated with the dev workflow."
```

---

### Task 8: Maak `pdfium_renderer.rs` module met PDFium init

**Files:**
- Create: `open-pdf-studio/src-tauri/src/pdfium_renderer.rs`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (add `mod pdfium_renderer;`, init in `run()`)

- [ ] **Step 1: Maak het nieuwe module-bestand**

Create `open-pdf-studio/src-tauri/src/pdfium_renderer.rs` met de volgende inhoud:

```rust
//! PDFium rendering integration for Open PDF Studio.
//!
//! Wraps the `pdfium-render` crate with the bindings we need for
//! `render_pdf_page` and `render_thumbnail` Tauri commands. Owns a
//! single static `Pdfium` instance for the lifetime of the app.
//!
//! Thread-safety: the `sync` feature of `pdfium-render` wraps every
//! call in an internal mutex, so multiple Tauri command threads can
//! invoke `render_page_pdfium` concurrently — they just serialise
//! inside PDFium.

use std::path::Path;
use std::sync::OnceLock;
use pdfium_render::prelude::*;

/// Global PDFium instance. Initialised once at app start by
/// `init_pdfium`. Subsequent calls to `pdfium()` are zero-cost lookups.
static PDFIUM: OnceLock<Pdfium> = OnceLock::new();

/// Initialise the PDFium runtime by dynamically loading the DLL at the
/// given path. Call this exactly once during app startup, before any
/// Tauri command runs.
///
/// On failure (DLL missing / corrupt / wrong arch) this returns an
/// error containing the underlying message — the caller should treat
/// this as fatal because no PDF rendering is possible without PDFium.
pub fn init_pdfium(dll_dir: &Path) -> Result<(), String> {
    if PDFIUM.get().is_some() {
        return Ok(()); // Already initialised — idempotent.
    }

    let bindings = Pdfium::bind_to_library(
        Pdfium::pdfium_platform_library_name_at_path(dll_dir),
    )
    .map_err(|e| format!("Failed to load PDFium DLL from {:?}: {}", dll_dir, e))?;

    let pdfium = Pdfium::new(bindings);

    PDFIUM
        .set(pdfium)
        .map_err(|_| "PDFium was concurrently initialised".to_string())?;

    Ok(())
}

/// Access the global PDFium instance. Panics if `init_pdfium` was
/// never called or failed — callers should rely on app-start order to
/// guarantee initialisation.
pub fn pdfium() -> &'static Pdfium {
    PDFIUM
        .get()
        .expect("PDFium not initialised. Call init_pdfium() during app startup.")
}
```

- [ ] **Step 2: Wire het module in `src-tauri/src/lib.rs`**

Open `open-pdf-studio/src-tauri/src/lib.rs`. Bovenaan, na de bestaande `mod` declarations (zoek `mod mcp_server;` of `mod render_to_png;`), voeg toe:

```rust
mod pdfium_renderer;
```

- [ ] **Step 3: Roep `init_pdfium` aan in de Tauri-builder `setup` hook**

Zoek in `lib.rs` de `pub fn run` functie (regel ~1468), specifiek de `tauri::Builder::default()` chain met `.setup(|app| { ... })`. Als er nog geen `.setup` is, voeg toe; als er al is, voeg de PDFium-init toe binnen de bestaande setup-closure.

De code-injectie in de setup-closure (typisch direct na `tauri::Builder::default()` of na bestaande plugin-inits):

```rust
        .setup(|app| {
            // Locate pdfium.dll alongside the executable (dev: target/debug/,
            // release: installer-resources/). resource_dir() returns the
            // directory where Tauri's bundle.resources land.
            let resource_dir = app
                .path()
                .resource_dir()
                .map_err(|e| format!("Cannot resolve resource_dir: {}", e))?;

            pdfium_renderer::init_pdfium(&resource_dir)
                .map_err(|e| format!("PDFium initialisation failed: {}", e))?;

            log::info!("PDFium initialised from {:?}", resource_dir);
            Ok(())
        })
```

Belangrijk: `app.path()` is een methode op `tauri::AppHandle`. De `setup` closure ontvangt `&mut tauri::App` als argument — gebruik `app.handle().path()` als de directe methode niet beschikbaar is. Op Tauri 2.10 is `app.path()` op `App` direct beschikbaar.

Als er al een `.setup` block bestaat, plak de PDFium init code direct vóór de bestaande `Ok(())` regel.

- [ ] **Step 4: Voeg `tauri::Manager` use toe als die nog ontbreekt**

```bash
grep -n "use tauri::Manager" open-pdf-studio/src-tauri/src/lib.rs
```

Als 0 hits: voeg `use tauri::Manager;` toe bij de andere `use tauri::...` regels bovenaan `lib.rs`. `app.path()` heeft `Manager` nodig.

- [ ] **Step 5: Verifieer cargo build slaagt**

```bash
cd open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: build slaagt. Bij `cannot find function pdfium_platform_library_name_at_path`: open `https://docs.rs/pdfium-render/latest/pdfium_render/struct.Pdfium.html` en zoek de juiste helper-naam in v0.9.x (typisch `pdfium_platform_library_name_at_path` of `pdfium_dynamic_lib_path`).

- [ ] **Step 6: Verifieer dat de app start zonder paniek**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
# Verifieer dat de DLL beschikbaar is op de dev-locatie
cp open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll open-pdf-studio/src-tauri/target/debug/ 2>/dev/null || true

# Start de app in achtergrond
cd open-pdf-studio && npm run tauri:dev > /tmp/tauri-dev-pdfium-init.log 2>&1 &
sleep 30

# Verifieer dat de log de PDFium init regel bevat
grep -i "pdfium initialised\|pdfium initialised\|PDFium initialisation failed" /tmp/tauri-dev-pdfium-init.log
```

Expected: regel `"PDFium initialised from ..."` zichtbaar in de log. Geen `PDFium initialisation failed`.

Als de app niet start: de log toont waar de DLL gezocht werd. Kopieer de DLL daar handmatig naartoe en herstart.

- [ ] **Step 7: Stop tauri-dev**

```bash
# Vind het process en stop het
pkill -f "tauri dev" 2>/dev/null || true
pkill -f "open-pdf-studio.exe" 2>/dev/null || true
```

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/src-tauri/src/pdfium_renderer.rs open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(pdfium): add PDFium init module with global instance

New file src-tauri/src/pdfium_renderer.rs holds a OnceLock<Pdfium>
that's initialised in the Tauri setup hook via dynamic-link binding
to pdfium.dll alongside the executable.

App now panics at startup if PDFium init fails (DLL missing or
corrupt) — this is intentional, since no rendering is possible
without it.

No commands swapped yet; rendering still goes through open-pdf-render."
```

---

### Task 9: Voeg PDFium document-cache toe

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/pdfium_renderer.rs` (add wrapper + cache types)
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (register `.manage(PdfiumDocCache::default())`)

- [ ] **Step 1: Voeg `PdfiumDocCache` types toe aan `pdfium_renderer.rs`**

Open `open-pdf-studio/src-tauri/src/pdfium_renderer.rs`. Voeg helemaal onderaan toe:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Wrapper around a loaded PDFium document. Holds the parsed byte buffer
/// alive for the document's lifetime via `Arc<Vec<u8>>`, and the raw
/// `PdfDocument<'static>` (lifetime extended unsafely via the static
/// PDFIUM ref). We never let the bytes outlive the wrapper, so this is
/// sound.
pub struct PdfiumDocumentHandle {
    // Order matters: `_bytes` must outlive `document`.
    document: PdfDocument<'static>,
    _bytes: Arc<Vec<u8>>,
}

impl PdfiumDocumentHandle {
    /// Construct a handle from raw PDF bytes. Returns Err on parse failure
    /// (corrupt PDF / unsupported encryption / etc).
    pub fn load_from_bytes(bytes: Arc<Vec<u8>>) -> Result<Self, String> {
        // Safety: the document borrows from `bytes`. We bind the lifetime to
        // 'static here because (a) `_bytes` is kept alive in the same struct,
        // and (b) the inner Pdfium instance is also 'static.
        let bytes_ref: &'static [u8] = unsafe {
            std::slice::from_raw_parts(bytes.as_ptr(), bytes.len())
        };

        let document = pdfium()
            .load_pdf_from_byte_slice(bytes_ref, None)
            .map_err(|e| format!("Failed to load PDF via PDFium: {}", e))?;

        Ok(Self {
            document,
            _bytes: bytes,
        })
    }

    pub fn document(&self) -> &PdfDocument<'static> {
        &self.document
    }
}

/// Document-handle cache. Tauri state. Keyed by full file path.
#[derive(Default)]
pub struct PdfiumDocCache(pub Mutex<HashMap<String, Arc<PdfiumDocumentHandle>>>);
```

- [ ] **Step 2: Voeg een helper toe die een handle opzoekt of laadt**

In dezelfde file `pdfium_renderer.rs`, onderaan:

```rust
/// Get an Arc-wrapped PdfiumDocumentHandle for `path`. Reads bytes from
/// disk on cache miss (cheap because OS file-cache will warm). For the
/// production hot path we expect the call site to feed bytes from the
/// existing PdfBytesCache instead — see `get_or_load_pdfium_doc_with_bytes`.
pub fn get_or_load_pdfium_doc(
    path: &str,
    cache: &PdfiumDocCache,
) -> Result<Arc<PdfiumDocumentHandle>, String> {
    {
        let map = cache.0.lock().map_err(|e| format!("Pdfium doc cache lock: {}", e))?;
        if let Some(h) = map.get(path) {
            return Ok(h.clone());
        }
    }

    let bytes = std::fs::read(path).map_err(|e| format!("Read {}: {}", path, e))?;
    let arc_bytes = Arc::new(bytes);
    let handle = Arc::new(PdfiumDocumentHandle::load_from_bytes(arc_bytes)?);

    let mut map = cache.0.lock().map_err(|e| format!("Pdfium doc cache lock: {}", e))?;
    // Double-check after parse to avoid race-double-load.
    if let Some(existing) = map.get(path) {
        return Ok(existing.clone());
    }
    map.insert(path.to_string(), handle.clone());
    Ok(handle)
}

/// Same as above but bytes are supplied directly. Used by Tauri commands
/// that already cache bytes via PdfBytesCache.
pub fn get_or_load_pdfium_doc_with_bytes(
    path: &str,
    bytes: Arc<Vec<u8>>,
    cache: &PdfiumDocCache,
) -> Result<Arc<PdfiumDocumentHandle>, String> {
    {
        let map = cache.0.lock().map_err(|e| format!("Pdfium doc cache lock: {}", e))?;
        if let Some(h) = map.get(path) {
            return Ok(h.clone());
        }
    }

    let handle = Arc::new(PdfiumDocumentHandle::load_from_bytes(bytes)?);

    let mut map = cache.0.lock().map_err(|e| format!("Pdfium doc cache lock: {}", e))?;
    if let Some(existing) = map.get(path) {
        return Ok(existing.clone());
    }
    map.insert(path.to_string(), handle.clone());
    Ok(handle)
}
```

- [ ] **Step 3: Registreer `PdfiumDocCache` als Tauri state in `lib.rs`**

Open `open-pdf-studio/src-tauri/src/lib.rs`. Zoek de `.manage(...)` chain in `run()` waar bestaande caches als `PdfBytesCache` en `DocHandleCache` worden geregistreerd. Voeg toe:

```rust
        .manage(pdfium_renderer::PdfiumDocCache::default())
```

Hou dezelfde indentatie als de andere `.manage` regels.

- [ ] **Step 4: Voeg `clear_pdf_cache` ook de PDFium-cache toe**

Zoek `fn clear_pdf_cache(...)` in `lib.rs` (rond regel 1442). Voeg een parameter toe:

```rust
fn clear_pdf_cache(
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
    thumb_cache: tauri::State<ThumbnailCache>,
    pdfium_cache: tauri::State<pdfium_renderer::PdfiumDocCache>,
) -> Result<bool, String> {
    bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?.clear();
    handle_cache.0.lock().map_err(|e| format!("Handle cache lock: {}", e))?.clear();
    if let Ok(mut tc) = thumb_cache.0.lock() { tc.clear(); }
    if let Ok(mut pc) = pdfium_cache.0.lock() { pc.clear(); }
    Ok(true)
}
```

- [ ] **Step 5: Verifieer cargo build**

```bash
cd open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: build slaagt.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-studio/src-tauri/src/pdfium_renderer.rs open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(pdfium): add PdfiumDocumentHandle wrapper + doc cache

PdfiumDocumentHandle wraps PdfDocument<'static> alongside the Arc<Vec<u8>>
of bytes it borrows from. PdfiumDocCache holds these per file path.

get_or_load_pdfium_doc(path) reads from disk; the _with_bytes variant
takes bytes already cached by PdfBytesCache (the normal hot path).

clear_pdf_cache now also clears the PDFium cache."
```

---

## Fase 3 — Tauri-commands omzetten

Hier verandert het runtime-gedrag. Per command meten we zowel functionaliteit (visueel correct) als performance.

### Task 10: Implementeer `render_page_pdfium` helper

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/pdfium_renderer.rs` (add `render_page_to_rgba`)

- [ ] **Step 1: Voeg render-helper toe aan `pdfium_renderer.rs`**

Onderaan `open-pdf-studio/src-tauri/src/pdfium_renderer.rs`, voeg toe:

```rust
/// Render a single page to RGBA pixel bytes at the requested scale and
/// rotation. Returns (width, height, rgba) where rgba length is
/// width * height * 4.
///
/// `scale = 1.0` produces 1 PDF point = 1 pixel. The caller is
/// responsible for any DPR adjustment.
///
/// `rotation` is in degrees, must be one of 0, 90, 180, 270.
///
/// /AP annotation streams are rendered (FPDF_ANNOT flag on) so sticky
/// notes from Acrobat etc. appear, matching Chrome/Edge behaviour.
pub fn render_page_to_rgba(
    doc: &PdfDocument<'static>,
    page_index: u32,
    scale: f32,
    rotation: i32,
) -> Result<(u32, u32, Vec<u8>), String> {
    let pages = doc.pages();
    let page = pages
        .get(page_index as u16)
        .map_err(|e| format!("Page {} not found: {}", page_index, e))?;

    // PDF page size in points (PDFium uses 1 point = 1/72 inch).
    let width_pt = page.width().value;
    let height_pt = page.height().value;

    // Account for PDFium's own /Rotate handling. PDFium reports the
    // pre-rotation dims; for a user-requested additional rotation we
    // post-multiply.
    let target_w = (width_pt * scale).ceil() as i32;
    let target_h = (height_pt * scale).ceil() as i32;

    let rot = match rotation.rem_euclid(360) {
        0 => PdfPageRenderRotation::None,
        90 => PdfPageRenderRotation::Degrees90,
        180 => PdfPageRenderRotation::Degrees180,
        270 => PdfPageRenderRotation::Degrees270,
        other => return Err(format!("Unsupported rotation: {}", other)),
    };

    let config = PdfRenderConfig::new()
        .set_target_width(target_w)
        .set_maximum_height(target_h)
        .rotate(rot, true) // true: rotate clockwise
        .render_form_data(true) // = FPDF_ANNOT flag (existing PDF /AP streams)
        .set_format(PdfBitmapFormat::BGRA);

    let bitmap = page
        .render_with_config(&config)
        .map_err(|e| format!("PDFium render failed: {}", e))?;

    let actual_w = bitmap.width() as u32;
    let actual_h = bitmap.height() as u32;
    let rgba = bitmap.as_rgba_bytes();

    Ok((actual_w, actual_h, rgba))
}
```

Toelichting over de API:
- `PdfBitmapFormat::BGRA` is PDFium's native format. `as_rgba_bytes()` doet de BGRA→RGBA omzet for us.
- `set_target_width` + `set_maximum_height` is een aspect-respecting fit. Voor exact-mappings is dat OK omdat we de scale berekenen om bij beide pixel-dimensies aan te sluiten.
- Alternatieve API (`set_target_size` of `set_target_width_and_height`) bestaat in nieuwere versies — kies wat in v0.9.x werkt.

- [ ] **Step 2: Verifieer cargo build**

```bash
cd open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: build slaagt. Bij API-mismatch (bijv. `rotate` heeft ander signature in v0.9): open `https://docs.rs/pdfium-render/0.9.2/pdfium_render/struct.PdfRenderConfig.html` en pas de chained methode-calls aan tot het compileert.

- [ ] **Step 3: Schrijf een Rust integratietest die BARN p1 rendert**

Maak nieuwe test file: `open-pdf-studio/src-tauri/tests/pdfium_smoke.rs`

```rust
//! Smoke test for the PDFium renderer module. Only runs if the
//! `OPEN_PDF_STUDIO_TEST_PDF` environment variable points at a
//! readable PDF and pdfium.dll is on the system PATH or in the
//! current working directory.

use std::path::PathBuf;
use std::sync::Arc;

use app_lib::pdfium_renderer::{
    init_pdfium, get_or_load_pdfium_doc_with_bytes, render_page_to_rgba, PdfiumDocCache,
};

#[test]
fn pdfium_renders_barn_page_one() {
    let pdf_path = match std::env::var("OPEN_PDF_STUDIO_TEST_PDF") {
        Ok(p) => p,
        Err(_) => {
            eprintln!("Skipping: set OPEN_PDF_STUDIO_TEST_PDF env var to a PDF path");
            return;
        }
    };

    let dll_dir: PathBuf = std::env::var("OPEN_PDF_STUDIO_TEST_DLL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            // Best-effort: assume DLL is alongside the test runner exe
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|q| q.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."))
        });

    init_pdfium(&dll_dir).expect("init_pdfium");

    let bytes = std::fs::read(&pdf_path).expect("read pdf");
    let arc_bytes = Arc::new(bytes);

    let cache = PdfiumDocCache::default();
    let handle = get_or_load_pdfium_doc_with_bytes(&pdf_path, arc_bytes, &cache)
        .expect("load pdfium doc");

    let (w, h, rgba) = render_page_to_rgba(handle.document(), 0, 1.0, 0)
        .expect("render page");

    assert!(w > 100, "width should be reasonable, got {}", w);
    assert!(h > 100, "height should be reasonable, got {}", h);
    assert_eq!(rgba.len(), (w * h * 4) as usize, "rgba size mismatch");

    // Spot-check: page should not be all-white
    let non_white = rgba
        .chunks(4)
        .filter(|p| p[0] != 255 || p[1] != 255 || p[2] != 255)
        .count();
    assert!(non_white > 100, "Page is mostly white — render likely empty");
}
```

Bij compileer-error op `app_lib::pdfium_renderer::...`: de items moeten `pub` zijn — verifieer in `pdfium_renderer.rs` dat de relevante functies, types en modules `pub` zijn, en dat in `lib.rs` `pub mod pdfium_renderer;` staat (niet alleen `mod`).

- [ ] **Step 4: Run de smoke test**

```bash
cd open-pdf-studio/src-tauri
# Kopieer DLL naar target dir if needed
cp ../../open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll target/debug/deps/ 2>/dev/null || true
cp ../../open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll target/debug/ 2>/dev/null || true

OPEN_PDF_STUDIO_TEST_PDF="C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf" \
OPEN_PDF_STUDIO_TEST_DLL_DIR="C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/src-tauri/binaries/win-x64" \
cargo test --test pdfium_smoke -- --nocapture 2>&1 | tail -20
```

Expected: test passes met `non_white > 100` assertions.

Bij DLL-load failure: zorg dat `pdfium.dll` in `target/debug/deps/` of `target/debug/` staat, of pas `OPEN_PDF_STUDIO_TEST_DLL_DIR` aan naar de werkelijke locatie.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-studio/src-tauri/src/pdfium_renderer.rs open-pdf-studio/src-tauri/tests/pdfium_smoke.rs
git commit -m "feat(pdfium): add render_page_to_rgba + smoke test

render_page_to_rgba renders a PdfPage at a given scale + rotation,
returns (width, height, rgba) tuple. /AP annotation streams are
rendered (render_form_data(true)).

Smoke test in tests/pdfium_smoke.rs loads BARN page 1, verifies
output is non-empty and dimensions are sane. Skipped if the test
PDF env var is unset, so CI without it just no-ops."
```

---

### Task 11: Swap `render_pdf_page` Tauri command naar PDFium

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (replace body of `render_pdf_page`)

- [ ] **Step 1: Vervang de body van `render_pdf_page`**

Open `open-pdf-studio/src-tauri/src/lib.rs`. Zoek `fn render_pdf_page(` (rond regel 1177). Vervang het volledige fn-blok:

```rust
#[tauri::command]
fn render_pdf_page(
    path: String,
    page_index: u32,
    scale: f32,
    rotation: Option<i32>,
    bytes_cache: tauri::State<PdfBytesCache>,
    pdfium_cache: tauri::State<pdfium_renderer::PdfiumDocCache>,
) -> Result<tauri::ipc::Response, String> {
    let extra_rot = rotation.unwrap_or(0);

    // Get bytes from the existing cache (or read from disk if absent).
    let bytes = {
        let mut bm = bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?;
        if let Some(cached) = bm.get(&path) {
            cached.clone()
        } else {
            let read = std::fs::read(&path).map_err(|e| format!("Read: {}", e))?;
            bm.insert(path.clone(), read.clone());
            read
        }
    };

    let handle = pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
        &path,
        std::sync::Arc::new(bytes),
        &pdfium_cache,
    )?;

    let (width, height, rgba) = pdfium_renderer::render_page_to_rgba(
        handle.document(),
        page_index,
        scale,
        extra_rot,
    )?;

    // Wire format unchanged: [width: u32 LE][height: u32 LE][rgba bytes...]
    let mut data = Vec::with_capacity(8 + rgba.len());
    data.extend_from_slice(&width.to_le_bytes());
    data.extend_from_slice(&height.to_le_bytes());
    data.extend_from_slice(&rgba);
    Ok(tauri::ipc::Response::new(data))
}
```

De parameters wijzigen: `handle_cache: DocHandleCache` is weg — die werd alleen door de oude `get_or_load_doc` gebruikt. Vervangen door `pdfium_cache`. De wire format blijft identiek (8-byte header + RGBA).

- [ ] **Step 2: Verifieer cargo build**

```bash
cd open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: slaagt. Eventuele warning over ongebruikte `DocHandleCache` import is OK — die wordt nog in andere commands gebruikt.

- [ ] **Step 3: Verifieer dat de bench-harness werkt met PDFium**

Zorg dat de Tauri dev app draait (zelfde flow als eerder):

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
# In een aparte terminal:
# WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm --prefix open-pdf-studio run tauri:dev

# Wacht tot CDP up is, dan:
node pocs/shared/bench-raw-cdp.mjs --fixture barn --scenario cold_open_p1 2>&1 | grep -E "median_ms|min_ms|max_ms"
```

Expected: `median_ms < 400`. Bij grotere getallen: rapporteer en STOP — er gaat iets fundamenteel mis (DLL load per render?).

- [ ] **Step 4: Open BARN in de app en bekijk page 1 visueel**

Manual: gebruik de Tauri dev app, open `test pdf-bestanden/Originele bestanden/20260316 - Barn Relocation - ... - for Permit.pdf`. Verifieer dat page 1 correct rendert — alle tekst leesbaar, tekeningen aanwezig, kleuren juist.

Schrijf bevindingen in een tijdelijke notitie (mag in commit message):
- Render-tijd subjectief (snel/normaal/traag)
- Visuele afwijkingen vs het beeld in Chrome/Edge
- Sticky note annotaties zichtbaar?

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(pdfium): swap render_pdf_page Tauri command to PDFium

render_pdf_page no longer goes through open-pdf-render — it loads
the PDF via pdfium_renderer::get_or_load_pdfium_doc_with_bytes and
renders via render_page_to_rgba.

Wire format unchanged: 8-byte LE header + RGBA bytes.

Bench BARN cold_open_p1 measured at <vul in> ms (was 833 ms with
tiny-skia + PoC02+PoC04).

Visual spot-check on BARN page 1: <vul in: OK / regression-found>."
```

---

### Task 12: Implementeer `render_thumbnail_pdfium` helper

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/pdfium_renderer.rs` (add `render_thumbnail_to_jpeg`)

- [ ] **Step 1: Voeg thumbnail-helper toe aan `pdfium_renderer.rs`**

Onderaan `pdfium_renderer.rs`:

```rust
use base64::Engine;
use image::{ImageEncoder, ColorType};
use image::codecs::jpeg::JpegEncoder;

/// Render a low-resolution thumbnail of a single page, encoded as a
/// data-URL JPEG string ready to use as the `src` of an `<img>`.
///
/// `max_width` is in pixels — the page is scaled so the longest side
/// fits within this. Aspect ratio preserved.
///
/// Returns the data URL string (format: `data:image/jpeg;base64,...`).
pub fn render_thumbnail_to_data_url(
    doc: &PdfDocument<'static>,
    page_index: u32,
    max_width: u32,
    rotation: i32,
) -> Result<String, String> {
    let pages = doc.pages();
    let page = pages
        .get(page_index as u16)
        .map_err(|e| format!("Page {}: {}", page_index, e))?;

    let w_pt = page.width().value;
    let h_pt = page.height().value;
    let scale = max_width as f32 / w_pt.max(h_pt);

    let (w, h, rgba) = render_page_to_rgba(doc, page_index, scale, rotation)?;

    // Convert RGBA → RGB for JPEG (JPEG doesn't support alpha).
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for chunk in rgba.chunks(4) {
        rgb.push(chunk[0]);
        rgb.push(chunk[1]);
        rgb.push(chunk[2]);
    }

    let mut jpeg_bytes = Vec::with_capacity(rgb.len() / 4);
    let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 75);
    encoder
        .encode(&rgb, w, h, ColorType::Rgb8.into())
        .map_err(|e| format!("JPEG encode: {}", e))?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}
```

- [ ] **Step 2: Verifieer cargo build**

```bash
cd open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: slaagt.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-studio/src-tauri/src/pdfium_renderer.rs
git commit -m "feat(pdfium): add render_thumbnail_to_data_url helper

Renders a page at max_width-fit scale, JPEG-encodes the RGB output
at quality 75, returns a data:image/jpeg;base64,... data URL.

Re-uses render_page_to_rgba for the raster step."
```

---

### Task 13: Swap `render_thumbnail` Tauri command naar PDFium

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (replace body of `render_thumbnail`)

- [ ] **Step 1: Vervang de body van `render_thumbnail`**

Open `open-pdf-studio/src-tauri/src/lib.rs`. Zoek `fn render_thumbnail(` (rond regel 1209). Vervang het volledige fn-blok:

```rust
#[tauri::command]
fn render_thumbnail(
    path: String,
    page_index: u32,
    max_width: u32,
    rotation: Option<i32>,
    skip_images: Option<bool>,
    bytes_cache: tauri::State<PdfBytesCache>,
    pdfium_cache: tauri::State<pdfium_renderer::PdfiumDocCache>,
    thumb_cache: tauri::State<ThumbnailCache>,
) -> Result<String, String> {
    let extra_rot = rotation.unwrap_or(0);
    // skip_images: PDFium renders form-data on by default but doesn't
    // expose a "drop image XObjects" knob — accept the option for API
    // compat but ignore it. PDFium is fast enough that the thumbnail
    // doesn't need to drop images.
    let _ = skip_images;

    let cache_key = (path.clone(), page_index, max_width, extra_rot);
    if let Ok(tc) = thumb_cache.0.lock() {
        if let Some(cached) = tc.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let bytes = {
        let mut bm = bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?;
        if let Some(cached) = bm.get(&path) {
            cached.clone()
        } else {
            let read = std::fs::read(&path).map_err(|e| format!("Read: {}", e))?;
            bm.insert(path.clone(), read.clone());
            read
        }
    };

    let handle = pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
        &path,
        std::sync::Arc::new(bytes),
        &pdfium_cache,
    )?;

    let data_url = pdfium_renderer::render_thumbnail_to_data_url(
        handle.document(),
        page_index,
        max_width,
        extra_rot,
    )?;

    if let Ok(mut tc) = thumb_cache.0.lock() {
        tc.insert(cache_key, data_url.clone());
    }
    Ok(data_url)
}
```

- [ ] **Step 2: Verifieer cargo build**

```bash
cd open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: slaagt.

- [ ] **Step 3: Verifieer dat thumbnails in de app verschijnen**

Manual: start Tauri dev app, open BARN, scroll naar de thumbnail-strip aan de linkerkant van de page. Verifieer dat alle 7 thumbnails verschijnen binnen ~1-2 seconden.

- [ ] **Step 4: Bench-meting**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
node pocs/shared/bench-layers.mjs --fixture barn --runs 5 2>&1 | tail -25
```

Expected: `renderThumb1_ms` median < 100 ms (huidig 170 ms), `allThumbs_ms` median < 700 ms (huidig 1376 ms).

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(pdfium): swap render_thumbnail Tauri command to PDFium

render_thumbnail now routes through pdfium_renderer::
render_thumbnail_to_data_url. Cache key + ThumbnailCache behaviour
unchanged. skip_images param accepted but ignored (PDFium has no
equivalent knob and doesn't need one).

Bench BARN 7 thumbnails measured at <vul in> ms (was 1376 ms)."
```

---

### Task 14: Migreer `mcp_server.rs` render-calls naar PDFium

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/mcp_server.rs`

- [ ] **Step 1: Vind alle bestaande PDF-render-aanroepen in mcp_server.rs**

```bash
grep -n "DocumentHandle::load\|render_page" open-pdf-studio/src-tauri/src/mcp_server.rs | head -10
```

Expected: 2-3 call sites die `open_pdf_render::DocumentHandle::load(&pdf_bytes)` doen en daarna `.render_page(...)`.

- [ ] **Step 2: Vervang elke call site door de PDFium-flow**

Voor elke aanroep van het patroon:

```rust
let doc = open_pdf_render::DocumentHandle::load(&pdf_bytes)
    .map_err(|e| format!("Load PDF: {}", e))?;
let page = doc.render_page(page_index, scale, rotation)
    .map_err(|e| format!("Render: {}", e))?;
```

Vervang door:

```rust
let arc_bytes = std::sync::Arc::new(pdf_bytes.to_vec());
let cache = crate::pdfium_renderer::PdfiumDocCache::default();
let handle = crate::pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
    "<path or unique key>", arc_bytes, &cache,
)?;
let (width, height, rgba) = crate::pdfium_renderer::render_page_to_rgba(
    handle.document(),
    page_index as u32,
    scale,
    rotation,
)?;
// `page.width` was u32 — `width` is also u32, drop-in.
// `page.rgba` was Vec<u8> — `rgba` is also Vec<u8>, drop-in.
```

Bij call sites die page.width/height/rgba lazily gebruiken: vervang `page.width` met `width`, `page.height` met `height`, `page.rgba` met `rgba`.

Voor mcp_server-context: er is geen vast file-path, dus geef een synthetische key door zoals `&format!("mcp:{}", pdf_bytes_sha256)` of simpelweg `"mcp-temp"` (de cache wordt direct na deze call gedropt anyway).

- [ ] **Step 3: Verifieer cargo build**

```bash
cd open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: slaagt.

- [ ] **Step 4: Verifieer de MCP-server endpoint nog werkt**

Manual: start de Tauri dev app. De MCP-server hangt aan de hoofd-app. Test door een MCP `render_pdf_page` tool-call te doen (via een externe MCP client of via een curl op de embedded JSON-RPC poort).

Of: skip de manuele MCP-test als geen MCP-client beschikbaar — beperk je tot het verifiëren dat `cargo build` slaagt en de app start.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-studio/src-tauri/src/mcp_server.rs
git commit -m "feat(pdfium): migrate mcp_server.rs render calls to PDFium

All open_pdf_render::DocumentHandle::load + .render_page chains
in mcp_server.rs now go through pdfium_renderer::
get_or_load_pdfium_doc_with_bytes + render_page_to_rgba.

Behaviour unchanged — same (width, height, rgba) tuple, MCP tool
response format identical."
```

---

### Task 15: Migreer `render_to_png.rs` naar PDFium

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/render_to_png.rs`

- [ ] **Step 1: Bekijk de huidige render-call in render_to_png.rs**

```bash
grep -n "DocumentHandle\|render_page" open-pdf-studio/src-tauri/src/render_to_png.rs
```

Verwachte hit op regel 77 (rond): `let doc = open_pdf_render::DocumentHandle::load(&pdf_bytes)`.

- [ ] **Step 2: Vervang met de PDFium-flow**

Zelfde patroon als in Task 14, Step 2. Pas de call site aan om PDFium te gebruiken. Behoud de PNG-encoding flow eronder (die gebruikt het bestaande `encode_rgba_to_png_base64` helper).

- [ ] **Step 3: Verifieer cargo build**

```bash
cd open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: slaagt.

- [ ] **Step 4: Test render-to-png via Tauri command**

In de Tauri dev app — als er een tool-bar knop is die `render_to_png` aanroept (printer-flow, screenshot-tool) — klik die en verifieer dat een PNG-output wordt gegenereerd. Anders skip de manuele test.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-studio/src-tauri/src/render_to_png.rs
git commit -m "feat(pdfium): migrate render_to_png.rs to PDFium

The screenshot/printer render path now routes through PDFium for
the rasterisation step. PNG encoding logic unchanged."
```

---

### Task 16: End-to-end visuele + performance verificatie

**Files:**
- None. Manual + bench.

- [ ] **Step 1: Visueel verifieer op alle vier corpus-fixtures**

Start de Tauri dev app. Open elk van de vier corpus-PDFs en doorloop alle pagina's. Noteer afwijkingen in een tijdelijke text-buffer.

```
- test pdf-bestanden/Originele bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf (BARN, 7 pages, raster-engineering)
- test pdf-bestanden/Originele bestanden/NKD1a_opm_aw.pdf (NKD1a, 7 pages, ATLAS-stress)
- test pdf-bestanden/Originele bestanden/Zware vector PDF.pdf (zware-vector, 30 pages)
- test pdf-bestanden/Originele bestanden/Tekst.pdf (tekst, 1 page)
```

Check op:
- Tekst leesbaar?
- Vector-tekeningen correct?
- Raster-afbeeldingen aanwezig en niet vervormd?
- Bestaande PDF /AP annotaties zichtbaar (sticky notes, free-text)?

- [ ] **Step 2: Performance bench draaien**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
# Per fixture:
for f in barn nkd1a zware-vector tekst; do
  echo "=== $f cold_open_p1 ==="
  node pocs/shared/bench-raw-cdp.mjs --fixture $f --scenario cold_open_p1 2>&1 | grep median_ms
done

for f in barn nkd1a; do
  echo "=== $f scroll_p1_to_p7 ==="
  node pocs/shared/bench-raw-cdp.mjs --fixture $f --scenario scroll_p1_to_p7 2>&1 | grep median_ms
done

echo "=== barn end-to-end ==="
node pocs/shared/bench-layers.mjs --fixture barn --runs 5 2>&1 | tail -30
```

Verifieer succescriteria uit de spec:
- BARN cold_open_p1 < 400 ms
- BARN scroll_p1_to_p7 < 1500 ms
- Geen regressie > 20% op `cold_open_p1` van tekst, zware-vector, nkd1a
- 7 thumbnails BARN < 700 ms

- [ ] **Step 3: Documenteer de resultaten in een commit-only resultaten-notitie**

Maak `docs/superpowers/historical/2026-05-15-pdfium-bench.md` met de gemeten getallen:

```markdown
# PDFium swap — bench-resultaten 2026-05-15

Gemeten op feat/fast-open-barn na fase 3 voltooiing.

## Cold open p1 (alle fixtures)

| Fixture | Pre-PoC baseline (main pre-PoC) | After PoC 02+04 (main) | PDFium (feat/fast-open-barn) |
|---------|--------------------------------|------------------------|------------------------------|
| barn | 797 ms | 833 ms | <vul in> ms |
| nkd1a | 148 ms | 121 ms | <vul in> ms |
| zware-vector | 1070 ms | 246 ms | <vul in> ms |
| tekst | 760 ms | 480 ms | <vul in> ms |

## scroll_p1_to_p7

| Fixture | Main (PoC 02+04) | PDFium |
|---------|------------------|--------|
| barn | 870 ms | <vul in> ms |
| nkd1a | 2030 ms | <vul in> ms |

## BARN end-to-end (bench-layers.mjs)

| Laag | Mediaan tiny-skia | Mediaan PDFium |
|------|-------------------|----------------|
| readFile | 271 ms | <vul in> ms |
| parse | 35 ms | <vul in> ms |
| renderP1 | 694 ms | <vul in> ms |
| renderThumb1 | 170 ms | <vul in> ms |
| allThumbs (7) | 1376 ms | <vul in> ms |
| total | 3084 ms | <vul in> ms |

## Visuele observaties

- BARN: <vul in>
- NKD1a: <vul in>
- Zware-vector: <vul in>
- Tekst: <vul in>

## Conclusie

<vul in: GO voor fase 4 / STOP en analyse>
```

- [ ] **Step 4: Beslis op go/no-go voor fase 4**

Als alle succescriteria zijn voldaan EN visueel geen ongewenste regressies: GO voor fase 4 (open-pdf-render render-helft verwijderen).

Als één of meer criteria niet zijn voldaan: STOP, melden bij user, sluit het stoppen-pad uit de spec (geen merge, behoud branch).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/historical/2026-05-15-pdfium-bench.md
git commit -m "docs(bench): PDFium swap end-to-end measurements

BARN cold_open_p1: <vul in> ms (was 833 ms — <vul in>% reduction)
BARN scroll_p1_to_p7: <vul in> ms (was 870 ms)
BARN 7 thumbnails: <vul in> ms (was 1376 ms — <vul in>% reduction)
BARN total end-to-end: <vul in> ms (was 3084 ms)

Visueel: <vul in: geen regressies / details>.

Beslissing: <vul in: GO / STOP>."
```

---

## Fase 4 — `open-pdf-render` render-helft verwijderen

Voer alleen uit na GO uit Task 16. De vector-render path (`extract_draw_commands`) blijft staan.

### Task 17: Verwijder `pixmap_cache` (PoC 04) uit DocumentHandle

**Files:**
- Modify: `open-pdf-render/src/parser.rs`

- [ ] **Step 1: Verwijder `PixmapCache` struct en alle helpers**

Open `open-pdf-render/src/parser.rs`. Zoek `struct PixmapCache` (rond regel 23-58) en de bijbehorende `impl PixmapCache { ... }`. Verwijder de struct, impl, en de `PIXMAP_CACHE_MAX_ENTRIES` constante.

- [ ] **Step 2: Verwijder het `pixmap_cache` field van `DocumentHandle`**

Verwijder de regel `pixmap_cache: Mutex<PixmapCache>,` (rond regel 65) uit de struct. Verwijder ook de constructor-initialisatie `pixmap_cache: Mutex::new(PixmapCache::new(PIXMAP_CACHE_MAX_ENTRIES)),` uit `DocumentHandle::load()` (rond regel 95).

- [ ] **Step 3: Verwijder `pixmap_cache_stats()` methode**

Verwijder `pub fn pixmap_cache_stats(&self) -> (usize, usize) { ... }` (rond regel 100).

- [ ] **Step 4: Verwijder de pixmap-cache lookups uit `render_page_internal`**

Zoek `fn render_page_internal` (rond regel 170). Verwijder het hele blok dat begint met `// PoC 04: pixmap-cache fast path` (rond regel 171-195) inclusief de `cache_key` `Option`, de read-side cache hit early-return, en de write-side cache insert aan het einde van de functie (rond regel 290-310).

NB: na deze stap is `render_page_internal` weer een pure renderer zonder cache — Task 19 verwijdert hem helemaal.

- [ ] **Step 5: Verifieer cargo build**

```bash
cd open-pdf-render && cargo build --release 2>&1 | tail -10
```

Expected: slaagt. Mogelijke warnings over ongebruikte imports — negeer voor nu.

- [ ] **Step 6: Verifieer src-tauri build**

```bash
cd ../open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: slaagt.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-render/src/parser.rs
git commit -m "refactor(render): remove pixmap_cache (PoC 04) from DocumentHandle

PixmapCache struct + DocumentHandle.pixmap_cache field + cache
lookup/insert logic in render_page_internal all gone. PDFium swap
made the pixmap-cache pattern obsolete: cold renders are fast
enough that caching 15-MB pixmaps doesn't earn its keep.

render_page_internal still exists but no longer caches; it's
removed in a later task."
```

---

### Task 18: Verwijder `doc_image_cache` (PoC 02) uit DocumentHandle

**Files:**
- Modify: `open-pdf-render/src/parser.rs`
- Modify: `open-pdf-render/src/interpreter.rs` (remove seed-in / merge-back logic, remove parameter)

- [ ] **Step 1: Verwijder het `doc_image_cache` field van `DocumentHandle`**

Open `open-pdf-render/src/parser.rs`. Verwijder de regel `doc_image_cache: Arc<RwLock<ImageCache>>,` uit de struct (rond regel 65, na de pixmap_cache regel die je in Task 17 al verwijderde). Verwijder ook de constructor-init `doc_image_cache: Arc::new(RwLock::new(ImageCache::new())),` uit `load()`.

- [ ] **Step 2: Verwijder `doc_image_cache_stats()` methode**

Verwijder `pub fn doc_image_cache_stats(&self) -> (usize, usize) { ... }` (rond regel 110-120).

- [ ] **Step 3: Verwijder de `doc_image_cache` parameter uit `execute*` calls**

In `parser.rs` `render_page_internal` (rond regel 243-247), zoek de `Interpreter::execute_with_image_limit` en `Interpreter::execute` calls. Verwijder het laatste argument `Some(&self.doc_image_cache)`.

- [ ] **Step 4: Pas de signature van `Interpreter::execute*` aan in interpreter.rs**

Open `open-pdf-render/src/interpreter.rs`. Verwijder de parameter `doc_image_cache: Option<&std::sync::Arc<std::sync::RwLock<ImageCache>>>` uit:
- `pub fn execute`
- `pub fn execute_with_image_limit`
- `fn execute_internal`
- `fn handle_do_execute`
- `pub fn render_annotation_appearance`

Voor `execute_internal`: verwijder ook het hele seed-in blok bij function entry (`if let Some(doc_cache) = doc_image_cache { ... }`) en het merge-back blok bij function exit.

- [ ] **Step 5: Verwijder de doorgegeven parameter uit alle recursive calls**

Binnen `execute_internal` en `handle_do_execute` en `render_annotation_appearance`, verwijder `doc_image_cache` uit elke `Self::execute_internal(...)` aanroep — er zijn er 3 (transparency group, fallback, regular Form XObject) plus 1 in render_annotation_appearance.

- [ ] **Step 6: Verifieer cargo build**

```bash
cd open-pdf-render && cargo build --release 2>&1 | tail -10
```

Expected: slaagt. Bij compileer-error: zorg dat alle `doc_image_cache` parameters consistent zijn weggehaald uit alle signatures EN call sites.

- [ ] **Step 7: Verifieer src-tauri build**

```bash
cd ../open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: slaagt.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-render/src/parser.rs open-pdf-render/src/interpreter.rs
git commit -m "refactor(render): remove doc_image_cache (PoC 02) from DocumentHandle

doc_image_cache field + ImageCache seed/merge logic in execute_internal
removed. PDFium swap made the doc-scoped image cache irrelevant —
that cache only mattered when render_page raster-rendered through
the open-pdf-render interpreter.

execute_internal still exists but is no longer called from any
render path; the vector-path's extract_commands runs alongside.
Renderer removal in a later task."
```

---

### Task 19: Verwijder `SkiaRenderer` + `renderer.rs`

**Files:**
- Delete: `open-pdf-render/src/renderer.rs`
- Modify: `open-pdf-render/src/lib.rs` (remove `pub mod renderer`)
- Modify: `open-pdf-render/src/parser.rs` (remove `render_page*`, `render_page_internal`, `render_page_annotations`)
- Modify: `open-pdf-render/src/interpreter.rs` (remove rendering helpers)

- [ ] **Step 1: Verwijder `render_page` en `render_page_with_image_limit` uit parser.rs**

Open `open-pdf-render/src/parser.rs`. Verwijder de drie publieke render-methoden:
- `pub fn render_page(...)` (rond regel 158-160)
- `pub fn render_page_with_image_limit(...)` (rond regel 166-168)
- `fn render_page_internal(...)` (rond regel 170-310, lang)
- `fn render_page_annotations(...)` (rond regel 314 — zit naast extract methods)

- [ ] **Step 2: Verwijder `render_annotation_appearance` uit interpreter.rs**

Open `open-pdf-render/src/interpreter.rs`. Zoek `pub fn render_annotation_appearance` (rond regel 2972) en verwijder het hele blok (ongeveer 100 regels tot de afsluitende `}`).

- [ ] **Step 3: Verwijder rendering-helpers uit interpreter.rs**

Verwijder de volgende interne rendering helpers (zoek per naam — laat alles wat met `extract_commands` te maken heeft staan):
- `fn handle_image_execute(...)` (rond regel 1100, indien aanwezig)
- `fn handle_do_execute` rendering branch (Form XObject `execute_internal` recursie blijft NU nog — wordt in stap 5 weggehaald)
- `fn predecode_images_parallel(...)` (rond regel 850)
- `pub(crate) fn decode_image_xobject(...)` (rond regel 918) — alleen als geen ander pad het meer gebruikt
- `struct CachedDecodedImage` + impl (rond regel 183)
- `pub(crate) type ImageCache = ...` (rond regel 197)
- Glyph-rendering helpers (zoek naar `tiny_skia::Path` uses)
- Path-painting helpers

NB: het is veiliger om dit incrementeel te doen. Per gevonden functie: probeer de cargo build te draaien, los compileer-errors op, dan volgende functie weghalen.

- [ ] **Step 4: Verwijder `execute_internal` rendering-paths**

In `interpreter.rs`, `execute_internal` heeft een lange `match` statement over PDF operators. De rendering operators (`Do`, `S`, `f`, `B`, `b`, `b*`, `n`, `Tj`, `TJ`, etc.) moeten verwijderd worden EXCEPT voor zover ze door extract_commands worden gebruikt. Sterke aanbeveling: behoud `execute_internal` voor nu en maak een aparte `execute_for_extract` als `extract_commands` een aparte pad heeft (kijk wat `extract_commands` aanroept in parser.rs:722).

Daadwerkelijk: `extract_commands` is een aparte functie (`Interpreter::extract_commands`) volledig los van `execute_internal`. Dus: `execute_internal` mag volledig weg, plus zijn bijbehorende `Interpreter::execute` en `execute_with_image_limit` public wrappers.

Verwijder:
- `pub fn execute(...)` (rond regel 200)
- `pub fn execute_with_image_limit(...)` (rond regel 215)
- `fn execute_internal(...)` (rond regel 230, lang — vermoedelijk 200+ regels)

- [ ] **Step 5: Verwijder `pub mod renderer` uit lib.rs**

Open `open-pdf-render/src/lib.rs`. Zoek `pub mod renderer;` (of `mod renderer;`) en verwijder het.

- [ ] **Step 6: Verwijder het `renderer.rs` bestand**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
rm open-pdf-render/src/renderer.rs
```

- [ ] **Step 7: Verifieer cargo build (verwacht een aantal errors die je moet fixen)**

```bash
cd open-pdf-render && cargo build --release 2>&1 | tail -30
```

Vermoedelijke errors:
- Ongebruikte imports in interpreter.rs (`tiny_skia::*` etc.) — verwijder de import-regels
- References naar `SkiaRenderer`, `Pixmap`, `Path`, `Paint`, etc. in resterende code — als die in `extract_commands` zit, kan het complexer worden; bekijk per error wat de juiste fix is.

Bij elke error: ga back naar de relevante file, verwijder de specifieke regel of refactor zo dat de extract path niet meer afhankelijk is van rendering types. Run `cargo build` opnieuw.

Iteratief doorgaan tot `cargo build` slaagt.

- [ ] **Step 8: Verifieer src-tauri build**

```bash
cd ../open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: slaagt.

- [ ] **Step 9: Verifieer dat `extract_draw_commands` nog werkt via de app**

Start Tauri dev, open BARN (of een vector-PDF). Door de logging in `loader.js` zie je of `extract_draw_commands` wordt aangeroepen — verifieer dat de vector-path nog werkt.

```bash
# Check console-log of de app via DevTools (F12) of via een quick CDP probe
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
node mcp-server/check-app-state.mjs 2>&1 | tail -5
```

- [ ] **Step 10: Commit**

```bash
git add open-pdf-render/
git commit -m "refactor(render): remove SkiaRenderer + render-half of open-pdf-render

Files removed:
- open-pdf-render/src/renderer.rs (SkiaRenderer)
- pub fn render_page + render_page_with_image_limit
- fn render_page_internal + render_page_annotations
- pub fn execute + execute_with_image_limit + execute_internal
- pub fn render_annotation_appearance
- struct CachedDecodedImage + type ImageCache
- predecode_images_parallel
- All tiny-skia-specific draw helpers

Kept (vector path):
- pub fn extract_draw_commands + _batch
- pub fn analyze_page_type
- pub fn page_count + page_dimensions* (used by viewer for page tree)
- Interpreter::extract_commands path
- font_registry + font_parser + draw_commands modules

open-pdf-render shrunk from ~12K to ~6K lines."
```

---

### Task 20: Verwijder `tiny-skia`, `turbojpeg`, `image` deps uit open-pdf-render

**Files:**
- Modify: `open-pdf-render/Cargo.toml`

- [ ] **Step 1: Bekijk de huidige dependencies**

```bash
cat open-pdf-render/Cargo.toml
```

Hits voor: `tiny-skia`, `turbojpeg`, `image`, `flate2`, `lopdf`, `rayon`, `hayro-font`, `ttf-parser`.

- [ ] **Step 2: Bepaal welke deps echt nog nodig zijn**

Voor de extract-path (`extract_draw_commands`, `extract_commands`, `analyze_page_type`):
- `lopdf` — JA, voor PDF parsing
- `hayro-font` — JA, voor Type1 font parsing (extract_commands emit glyph data)
- `ttf-parser` — JA, voor TrueType font parsing
- `flate2` — JA, content-stream decompressie
- `rayon` — JA, voor batch-parallelisme
- `tiny-skia` — NEE, alleen voor rasterisatie
- `turbojpeg` — NEE, alleen voor image decoding tijdens render
- `image` — NEE, alleen voor image decoding tijdens render

- [ ] **Step 3: Verwijder de overbodige deps uit Cargo.toml**

Open `open-pdf-render/Cargo.toml`. Verwijder de regels:
```toml
tiny-skia = "0.11"
turbojpeg = { version = "1", default-features = false, features = ["image", "cmake"] }
image = { version = "0.25", default-features = false, features = ["jpeg", "png"] }
```

- [ ] **Step 4: Verifieer cargo build**

```bash
cd open-pdf-render && cargo build --release 2>&1 | tail -10
```

Expected: slaagt. Bij errors over `image::` of `tiny_skia::` references: er zijn nog resterende imports in interpreter.rs of elders — terug naar Task 19 Step 7 om die op te lossen.

- [ ] **Step 5: Verifieer dat de `[profile.dev.package.tiny-skia*]` blocks in src-tauri/Cargo.toml ook weg kunnen**

```bash
cat open-pdf-studio/src-tauri/Cargo.toml | tail -20
```

Het bestaande `[profile.dev.package.tiny-skia]` en `[profile.dev.package.tiny-skia-path]` blokken zijn nu zinloos (geen tiny-skia meer in de afhankelijkheidsgraaf). Verwijder ze.

```bash
# Open en handmatig verwijderen, of via sed
sed -i.bak -e '/^\[profile\.dev\.package\.tiny-skia\]$/,/^opt-level/d' -e '/^\[profile\.dev\.package\.tiny-skia-path\]$/,/^opt-level/d' open-pdf-studio/src-tauri/Cargo.toml
rm open-pdf-studio/src-tauri/Cargo.toml.bak
```

Verifieer met `cat open-pdf-studio/src-tauri/Cargo.toml | tail -20` dat de tiny-skia profile-blokken weg zijn.

- [ ] **Step 6: Verifieer cargo build van src-tauri**

```bash
cd open-pdf-studio/src-tauri && cargo build 2>&1 | tail -10
```

Expected: slaagt. Bouwtijd zou flink korter moeten zijn — geen tiny-skia + turbojpeg + image compile meer.

- [ ] **Step 7: Verifieer dat de app start en BARN nog rendert**

Start Tauri dev, open BARN, render page 1, kijk dat er geen panics zijn.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
git add open-pdf-render/Cargo.toml open-pdf-render/Cargo.lock open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/Cargo.lock
git commit -m "build(deps): remove tiny-skia, turbojpeg, image from open-pdf-render

After SkiaRenderer + render path removal these three deps had no
remaining call sites. tiny-skia / turbojpeg compilation were the
slowest items in the dev rebuild loop — net build-time win.

Also dropped the [profile.dev.package.tiny-skia*] override blocks
in src-tauri/Cargo.toml (no longer in the dep graph)."
```

---

## Fase 5 — Archiveer PoC resultaten

### Task 21: Consolideer PoC 02 + PoC 04 resultaten in historical archive

**Files:**
- Create: `docs/superpowers/historical/poc-02-04-results.md`
- Modify: `pocs/02-doc-image-cache/results.md` (laat staan, voeg note toe)
- Modify: `pocs/04-bitmap-pyramid-prerender/results.md` (laat staan, voeg note toe)

- [ ] **Step 1: Maak de historical directory en het consolidated archive**

```bash
cd C:/Users/rickd/Documents/GitHub/open-pdf-studio
mkdir -p docs/superpowers/historical
```

Maak `docs/superpowers/historical/poc-02-04-results.md` met inhoud:

```markdown
# PoC 02 + PoC 04 — historische resultaten (vervangen door PDFium swap)

**Datum gearchiveerd:** 2026-05-15
**Status:** Gemerged in main op 2026-05-13 (commits fa4ee06d + bc7dc4f7), vervolgens
vervangen op `feat/fast-open-barn` door PDFium-swap (zie
`docs/superpowers/specs/2026-05-15-pdfium-renderer-swap-design.md`).

## Aanleiding

Op 13 mei 2026 zijn PoC 02 (doc-scoped image cache) en PoC 04 (per-page pixmap cache) in main
gemerged om de raster-heavy BARN PDF op tiny-skia-renderer onder controle te krijgen. De caches
leverden samen een 9.4× warm-scroll speedup op BARN en 11.8× op NKD1a.

Op 15 mei 2026 is besloten om de hele tiny-skia rasterizer te vervangen door PDFium (zie spec
hierboven). PDFium is zo veel sneller (rasterisatie via Skia GPU, ~10 jaar productie-tuning) dat
de PoC 02/04 caches:
- Niet meer nodig zijn: PDFium cold-render is sneller dan onze warm-render-met-cache
- Architecturele complexiteit toevoegen die niet meer zijn winst rechtvaardigt
- 600 MB worst-case geheugen kostten (PoC 04 met 40 entries × 15 MB)

## Samenvatting van de PoC 02 + 04 winsten

### PoC 02 — Document-scoped Image Cache

Doc-scoped HashMap<ObjectId, Arc<Vec<u8>>> die per-pagina decoded image-bytes deelt tussen
opeenvolgende `render_page` calls op hetzelfde document. Geseed in `execute_internal` entry,
merged-back op exit (insert-if-absent).

| Scenario | Pre-PoC | Met PoC 02 | Δ |
|----------|---------|-------------|---|
| BARN cold_open_p1 | 797 ms | 778 ms | -2.4% |
| BARN scroll_p1_to_p7 | 3357 ms | 1984 ms | -41% |
| BARN zoom_in_revisit | 1300 ms | 987 ms | -24% |
| BARN scroll_back_revisit | 7301 ms | 1946 ms | -73% |
| NKD1a scroll_p1_to_p7 | 23909 ms | 9788 ms | -59% |

Memory: BARN doc-cache na alle 7 pages = 125 entries / ~60 MB. Onder de 100 MB doelwaarde.

### PoC 04 — Full-page Pixmap Cache

Per-`DocumentHandle` bounded-FIFO cache van fully-rendered RenderedPage buffers, keyed op
(page_idx, quantised scale, rotation). Cache hits skippen het hele render-pad (inclusief
doc-image-cache lookups, content-stream executie, en annotation appearance rendering); alleen een
single Vec<u8> clone (~10 ms voor 15 MB BARN page) werd betaald.

| Scenario | Main (PoC 02) | Met PoC 04 | Δ |
|----------|---------------|-------------|---|
| BARN cold_open_p1 | 778 ms | 833 ms | +7% (binnen ruis) |
| BARN scroll_p1_to_p7 | 1984 ms | 870 ms | -56% |
| BARN zoom_in_revisit | 987 ms | 339 ms | -66% |
| BARN scroll_back_revisit | 1946 ms | 776 ms | -60% |

Vs pre-PoC main HEAD ee2139a8:
- BARN scroll_back_revisit: 7301 → 776 ms (9.4× sneller)
- NKD1a scroll_p1_to_p7: 23909 → 2030 ms (11.8× sneller)
- zware-vector zoom_in_revisit: 1483 → 180 ms (8.2× sneller)

Memory: 40 entries × ~15 MB = ~600 MB worst-case. Binnen 700 MB user-budget.

## Waarom vervangen door PDFium

Met PDFium is BARN cold_open_p1 ~150-200 ms (vs onze 700-800 ms tiny-skia render). De
factor-3-4 speedup op de cold-pass is groter dan wat PoC 02 + 04 op de warm-pass leverden vs
de pre-PoC baseline. Bovendien is de cold-pass de path die de meeste gebruikers ervaren —
warm-scenarios komen alleen voor bij re-scroll en re-zoom binnen dezelfde sessie.

Conclusie: PDFium is sneller én eenvoudiger. De PoC 02/04 caches blijven historisch interessant
voor de leertraject (zie het parlement en de PoC-iteratielogs voor de methodologie), maar zijn
niet meer in main.

## Volledige originele resultaten

- `pocs/02-doc-image-cache/results.md` — PoC 02 detail-meting
- `pocs/04-bitmap-pyramid-prerender/results.md` — PoC 04 detail-meting

Beide bestanden blijven op hun originele locatie behouden voor context.
```

- [ ] **Step 2: Voeg een note toe aan elk van de PoC results-bestanden**

Aan de TOP van `pocs/02-doc-image-cache/results.md` en `pocs/04-bitmap-pyramid-prerender/results.md`, voeg toe (vóór de bestaande titel):

```markdown
> **Status 2026-05-15: vervangen door PDFium-swap.** Zie
> `docs/superpowers/historical/poc-02-04-results.md` voor context.
> Dit results-bestand blijft als historisch artefact behouden.

---

```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/historical/poc-02-04-results.md pocs/02-doc-image-cache/results.md pocs/04-bitmap-pyramid-prerender/results.md
git commit -m "docs(historical): archive PoC 02 + PoC 04 results

Both PoCs were merged into main on 2026-05-13 to optimise the
tiny-skia renderer. Replaced on 2026-05-15 by the PDFium swap on
feat/fast-open-barn.

Original results.md files preserved in pocs/ with a banner pointing
at the consolidated archive."
```

---

## Self-Review

Voor elk spec-element check of er een task is:

| Spec-onderdeel | Task(s) |
|----------------|---------|
| Verwijder rust-text-extraction.js | Task 1 |
| Verwijder extract_text_spans | Task 1 |
| Verwijder mcp-server diagnostic scripts | Task 3 |
| Verwijder debug font extracts | Task 2 |
| Verwijder open-pdf-render/examples | Task 4 |
| Verwijder FEATURE_TILE_RENDERING | (gebleken niet aanwezig in main; geen task) |
| pdfium-render Cargo dep | Task 6 |
| pdfium.dll bundelen via Tauri resources | Tasks 5, 7 |
| Pdfium global init in lib.rs run() | Task 8 |
| PdfiumDocumentHandle wrapper + cache | Task 9 |
| `render_pdf_page` swap | Tasks 10, 11 |
| `render_thumbnail` swap | Tasks 12, 13 |
| /AP annotation rendering | Task 10 (render_form_data(true)) |
| BARN cold_open_p1 < 400 ms criterion | Task 16 (bench verificatie) |
| 7 thumbnails BARN < 700 ms criterion | Tasks 13, 16 |
| Visuele regressie op corpus | Task 16 |
| Verwijder SkiaRenderer + renderer.rs | Task 19 |
| Verwijder pixmap_cache (PoC 04) | Task 17 |
| Verwijder doc_image_cache (PoC 02) | Task 18 |
| Verwijder tiny-skia / turbojpeg / image deps | Task 20 |
| Migreer mcp_server.rs naar PDFium | Task 14 |
| Migreer render_to_png.rs naar PDFium | Task 15 |
| Archiveer PoC 02 + 04 resultaten | Task 21 |
| Behoud vector-render path | Tasks 17-20 (geen aanraking aan extract_*) |
| Behoud in-app annotation rendering | Geen task — niet aangeraakt |
| Geen release | Hele plan, expliciet geen tauri:build / version-bump |

Geen gaps gevonden.

## Execution Handoff

Plan complete en opgeslagen op `docs/superpowers/plans/2026-05-15-pdfium-renderer-swap.md`. Twee execution-opties:

**1. Subagent-Driven (recommended)** — Ik dispatch een verse subagent per taak, doe twee-stage review (spec compliance + code quality) tussen taken, snelle iteratie.

**2. Inline Execution** — Voer taken uit in deze sessie met checkpoints voor review tussen fasen.

**Welke aanpak?**
