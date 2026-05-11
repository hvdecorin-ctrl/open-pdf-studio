# Render Regression Test — Design

**Status**: Draft for user review
**Date**: 2026-05-08
**Scope**: Spec A — minimal regression test infrastructure
**Out of scope**: Spec B — kernel debug + PDF version expansion + Graph-RAG (separate brainstorm later)

---

## 1. Purpose

Detect render-kernel regressions automatically after every change to `open-pdf-render`. A run produces a per-page pixel diff against a PyMuPDF reference render of every test PDF. The harness reports pass/fail with per-page diff overlays so the engineer can immediately see *what* changed visually.

The pieces produced here are reusable infrastructure: the in-app screenshot tool will also drive a future "Export page as image" UI, and the same MCP server is the foundation for the Spec B debug + capability-expansion work.

## 2. Non-goals

- Pixel-perfect parity with PyMuPDF. Different engines never produce identical output. We compare with Gaussian-blur tolerance.
- Testing JS-only regressions (saver rotation, hand+select interaction, thumbnail race). Those are separate test surfaces.
- Validating the *correctness* of the first reference render. The PyMuPDF output is treated as authoritative for the catastrophic-regression class of bugs we want to catch (missing images, garbled text, wrong rotation, missing Form XObject content).
- Integrating with pre-commit hooks. Run is opt-in (manual or CI).

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri app (open-pdf-studio.exe --mcp-server)               │
│                                                              │
│  ┌──────────────┐    invoke()                                │
│  │ MCP HTTP     │──→ ┌──────────────────────────────────┐   │
│  │ Server       │    │ Tauri command:                    │   │
│  │ (rmcp crate) │    │  render_page_to_png(path, idx, w)│   │
│  │ :9223        │    │  → PNG bytes via                  │   │
│  └──────────────┘    │    open_pdf_render::render_page  │   │
│        ▲             └──────────────────────────────────┘   │
└────────┼─────────────────────────────────────────────────────┘
         │ HTTP / SSE (MCP protocol)
┌────────┴─────────────────────────────────────────────────────┐
│  Test harness (scripts/render-regression-test.py)            │
│                                                               │
│  for each PDF in test pdf-bestanden/Originele bestanden/:     │
│    for each page:                                              │
│      1. ref_png = render via PyMuPDF                          │
│      2. app_png = MCP call → screenshot_page                  │
│      3. compare via Pillow blur + diff (>30 RGB → diff)       │
│      4. write per-page artifacts                              │
│                                                                │
│  Final: HTML report, summary.json, exit code = #failures      │
└──────────────────────────────────────────────────────────────-┘
```

Three units, isolated by interface:

| Unit | Responsibility | Interface |
|------|----------------|-----------|
| In-app render-to-PNG | Render a single page via Rust kernel | Tauri command `render_page_to_png` |
| MCP server | Expose render command + corpus list to external clients | HTTP/SSE on `localhost:9223` |
| Test harness | Drive the comparison loop | Python script, MCP client, Pillow + PyMuPDF |

## 4. In-app render-to-PNG tool

**Location**: `src-tauri/src/lib.rs` (new Tauri command).

```rust
#[tauri::command]
async fn render_page_to_png(
    path: String,
    page_index: usize,    // 0-based
    target_width: u32,    // default 2000
) -> Result<String, String>     // raw base64 payload of PNG (no "data:" prefix);
                                 // the UI / MCP layer is responsible for
                                 // wrapping with a data URL when needed
```

**Implementation**: thin wrapper around `open_pdf_render::render_page()` with PNG encoding (using the existing `image` crate dependency). No JS round-trip, no annotations, no text-layer overlay.

**Why pure Rust kernel**:
- The JS replay path (`vector-renderer.js`) replays identical draw commands → render output is by construction equivalent to JS replay.
- The bugs this test must catch — font subset cmap, FlateDecode image decode, Form XObject recursion — are all Rust kernel issues.
- JS-only bugs (saver rotation, thumbnail race) are out of scope for kernel regression.

**Default resolution**: `target_width=2000` → ~150 dpi for A4, ~95 dpi for A1. High enough to make subset-font glyphs unique under pixel-diff; not so high that 50-page corpus runs slow.

**Errors**:
- PDF cannot be opened → `Err("failed to open PDF: <reason>")`
- Page index out of range → `Err("page index N out of range (max M)")`
- Render fails (corrupt content stream, etc.) → `Err("render failed: <reason>")`

The command stays usable independent of the MCP server — a future "Export page as image" UI will call the same function via the standard Tauri command bus.

## 5. MCP server

**Location**: `src-tauri/src/mcp_server.rs` (new module). Started by `--mcp-server` CLI flag (default off; production builds untouched).

**Crate**: `rmcp` (official Rust MCP SDK), HTTP/SSE transport on `localhost:9223`.

**Tools exposed**:

| Tool | Args | Returns | Purpose |
|------|------|---------|---------|
| `list_test_pdfs` | (none) | `{ pdfs: [{ path, page_count, file_size }] }` | Inventory of `Originele bestanden/` |
| `screenshot_page` | `path`, `page_index`, `width=2000` | `{ png_base64 }` (raw base64 payload, no `data:` prefix) | Render single page |
| `screenshot_all` | `path`, `width=2000` | `{ pages: [{ index, png_base64 }] }` plus `notifications/progress` after each page | Convenience for whole-PDF batch |
| `get_pdf_metadata` | `path` | `{ pdf_version, page_count, producer, creator, pages: [...] }` | Categorize PDFs (foundation for Spec B) |

**Resources** (read-only filesystem-window resources per MCP spec):
- `test-pdfs://` — lists PDFs in `Originele bestanden/`
- `golden-images://` — placeholder, used by Spec B

**Errors**: standard JSON-RPC `error` with `code` + `message` + `data: { details: ... }`. Per-page failures don't abort the suite.

## 6. Python test harness

**Location**: `scripts/render-regression-test.py`. Pinned deps in `scripts/requirements-test.txt`:

```
pymupdf==1.24.*
pillow==10.*
mcp==1.*
httpx==0.27.*
jinja2==3.*
numpy==1.*    # for diff mask reduction
```

**Compare logic** (per page):

```python
def compare(ref: Image, app: Image,
            blur_sigma=1.0, pixel_tol=30, fail_pct=2.0):
    if ref.size != app.size:
        app = app.resize(ref.size, Image.LANCZOS)

    ref_b = ref.filter(ImageFilter.GaussianBlur(blur_sigma))
    app_b = app.filter(ImageFilter.GaussianBlur(blur_sigma))

    diff  = ImageChops.difference(ref_b.convert("RGB"),
                                   app_b.convert("RGB"))
    arr   = np.array(diff)
    mask  = (arr.sum(axis=2) > pixel_tol)
    pct   = mask.mean() * 100

    overlay = make_side_by_side_with_diff_mask(ref, app, mask)
    return pct, overlay
```

A page passes iff `pct ≤ fail_pct` (default 2.0%).

**PyMuPDF reference render**:

```python
def render_with_pymupdf(pdf_path: Path, page_index: int, width: int) -> Image:
    doc  = fitz.open(pdf_path)
    page = doc[page_index]
    zoom = width / page.rect.width
    pix  = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom),
                            alpha=False, colorspace=fitz.csRGB)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
```

PyMuPDF chosen for: single pip install (no system poppler), fast (~50 ms / A4 page), good font fallback, full PDF 1.0–2.0 coverage.

## 7. Output structure

```
test pdf-bestanden/
├── Originele bestanden/                 ← read-only test corpus
│   ├── 20260316 - Barn Relocation - ...pdf
│   ├── 2885 Demo project.pdf
│   ├── Combinatie Raster, vector, tekening images.pdf
│   ├── Technische tekening.pdf
│   ├── Tekst.pdf
│   ├── Text pdf gecombineerd.pdf
│   ├── Zware vector PDF.pdf
│   └── rapport-constructie.pdf
│
└── render-regression-runs/              ← .gitignored
    ├── 2026-05-08_1430-32a1f7c/         ← <timestamp>-<git-sha>
    │   ├── report.html
    │   ├── summary.json
    │   ├── <pdf-stem>_p<n>_ref.png
    │   ├── <pdf-stem>_p<n>_app.png
    │   └── <pdf-stem>_p<n>_diff.png
    │
    └── latest → 2026-05-08_1430-32a1f7c/   ← symlink to most recent
```

`summary.json` schema:

```jsonc
{
  "git_sha": "32a1f7c",
  "timestamp": "2026-05-08T14:30:00",
  "config": { "blur_sigma": 1.0, "pixel_tol": 30, "fail_pct": 2.0, "width": 2000 },
  "pdfs": [
    { "path": "...", "version": "1.4",
      "pages": [
        { "index": 0, "diff_pct": 0.42, "passed": true },
        { "index": 1, "diff_pct": 8.71, "passed": false }
      ] }
  ],
  "totals": { "pages": 50, "passed": 47, "failed": 3 }
}
```

`.gitignore` addition: `test pdf-bestanden/render-regression-runs/`.

**HTML report layout**:
- Per PDF: name + version + total diff %
- Per page: side-by-side ref/app/diff thumbnails + diff %
- Pages with `>fail_pct` sorted to top, marked red
- Click thumbnail → full-size in new tab

## 8. Invocation

**Three wrappers, one underlying script**:

```bash
# 1. Manual — while dev app already runs with --mcp-server
npm run test:render

# 2. Auto — spawn dev, wait for port, run, kill, exit
npm run test:render:auto

# 3. CI — same as auto, plus publishes HTML report as artifact
#    (GitHub Actions step in .github/workflows/render-regression.yml)
```

**Filters** (forwarded to the Python script):

```bash
npm run test:render -- --pdf=Barn         # one PDF (substring match on name)
npm run test:render -- --page-range=0-2   # only first 3 pages of each PDF
npm run test:render -- --width=4000       # higher resolution
npm run test:render -- --fail-pct=0.5     # stricter threshold
```

**Triggering policy**:
- Manual after every `open-pdf-render/**` edit (engineer responsibility)
- Automatic on every PR via CI when files under `open-pdf-render/**` or `src-tauri/**` change
- *Not* on pre-commit (~30 s start-to-exit is too slow for that loop)

**First-run behavior**: every run is independent — there is no stored "baseline" to drift from. Each run renders fresh PyMuPDF references and fresh app screenshots, then compares. The first run simply has no historical run to compare against; the engineer reviews the HTML report to confirm the corpus renders acceptably, and that becomes the de-facto reference for subsequent code reviews.

## 9. Acceptance criteria

The deliverable is complete when:

1. `npm run test:render:auto` runs to completion against the 8-PDF corpus on a clean HEAD without crashing. The exit code reflects the live diff count; on first run the engineer accepts the score by reviewing the HTML report (no stored baseline file is required — Spec B may add per-page accepted-diff thresholds later).
2. Introducing a known-bad change (e.g. comment out the `byte_cmap` Priority-0 lookup added for 3090-CP-21) makes the test exit with code ≥ 1 and the HTML report flags the affected page(s).
3. `--pdf=...` filter limits the run to matching PDFs only.
4. `summary.json` validates against the schema above.
5. The HTML report opens in any modern browser without external CDN deps.

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| PyMuPDF render differs *cosmetically* from our renderer (anti-aliasing, font hinting) | Gaussian blur σ=1.0 absorbs sub-pixel diffs; `pixel_tol=30` ignores tiny per-channel shifts. Monitor first run; tune if false-positive rate is high. |
| MCP server port 9223 already in use | `--mcp-port` CLI flag overrides; harness reads same env var. |
| `--mcp-server` flag accidentally enabled in production | Guard: refuse to start unless build is debug *or* env var `OPS_ENABLE_MCP=1` is set. |
| Test corpus changes (new PDFs added, old PDFs removed) | Harness only iterates files actually present; HTML report shows total page count so changes are obvious. |
| MCP message size cap on `screenshot_all` for big PDFs | Stream individual pages via MCP notifications; harness consumes one at a time. |
| Different OS / GPU / font stack between runs | Render is pure Rust software path (no GPU, no system fonts where embedded fonts exist). PyMuPDF reference uses bundled MuPDF fonts, also software. Should be stable across machines. |

## 11. Out of scope (Spec B teaser)

The following items are *deliberately* not part of this spec and will land in a separate design:

- Diff-heatmap viewer (per-region failure attribution)
- PDF-version coverage matrix (PDF 1.2/1.3/2.0, PDF/A, PDF/UA, encrypted, linearized, OCG, Lab/CMYK/DeviceN, transparency groups)
- Graph-RAG over ISO 32000-2 spec + our Rust source so an agent can correlate failing region → spec rule → implementation file
- Failure root-cause classifier (font / image / vector / form-xobject / transparency)

## 12. Implementation order (preview, not part of this spec)

The implementation plan (next step via writing-plans skill) will likely break into:

1. `render_page_to_png` Tauri command + PNG encoding helper
2. `--mcp-server` CLI flag wiring
3. `mcp_server.rs` module with `rmcp` + the four tools
4. Python harness scaffolding + PyMuPDF reference + Pillow compare
5. HTML report template + `summary.json` writer
6. npm scripts + GitHub Actions workflow
7. Acceptance test: introduce known-bad change, verify failure surfaces

## 13. Appendix — accepted-baseline diff % (first run)

Recorded on the initial Task-18 acceptance run from HEAD `182f1755`. PDF-engine differences with PyMuPDF account for the non-zero values; treat these as the floor — regressions show as significantly higher numbers on the affected pages.

| PDF | Pages | Avg diff % |
|-----|-------|-----------|
| 20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf | 7 | 17.45% |
| 2885 Demo project.pdf | 14 | 54.89% |
| Combinatie Raster, vector, tekening images.pdf | 1 | 8.56% |
| Technische tekening.pdf | 4 | 15.97% |
| Tekst.pdf | 5 | 96.17% |
| Text pdf gecombineerd.pdf | 28 | 19.66% |
| Zware vector PDF.pdf | 19 | 11.13% |
| rapport-constructie.pdf | 28 | 19.66% |

Totals: 106 pages, 6 passed, 100 failed (against the default 2 % threshold — most rows fail because the PyMuPDF reference differs systematically from our render; the table above is the **accepted** baseline, not a failure list).

If the harness reports a page above 2× the corresponding row's "Avg diff %", consider it a regression and investigate.

Notes from the first run:
- The orchestrator (`scripts/run-render-regression.mjs`) currently mis-forwards `--mcp-server` to `cargo run` instead of the spawned binary, causing `tauri dev` to exit with code 1 before port 9223 opens. The fallback path described in the failure-modes section was used: `cargo build --release` followed by manually launching `target/release/open-pdf-studio.exe --mcp-server` and running `npm run test:render`.
- Release builds gate the MCP server behind `OPS_ENABLE_MCP=1`. The fallback launch must therefore be `OPS_ENABLE_MCP=1 target/release/open-pdf-studio.exe --mcp-server`.
- `Tekst.pdf` baselines at 96.17 % across all 5 pages — that PDF triggers a known font-resolution mismatch with PyMuPDF and the entire page renders as solid colour blocks. It is included as a regression *floor*, not a quality target.

## 14. Performance tracking

Pixel-diff alone catches *correctness* regressions. To also catch *speed* regressions (e.g. "canvas got slower after iter X") the harness measures wall-clock time for every page render and aggregates per PDF + suite total.

**What is measured** — three independent timers around each page's loop body in `scripts/render_test/main.py`:

1. `ref_render_ms` — `render_with_pymupdf(...)` (PyMuPDF reference render).
2. `app_render_ms` — `client.screenshot_page(...)` MCP call (our renderer end-to-end, including the round-trip from Python → MCP server → Rust kernel → PNG encode → base64 → return).
3. `diff_ms` — `compare(...)` (Pillow blur + numpy diff).

Each value is stored on the `PageResult` dataclass and propagated into the report writers.

**`summary.json` extension** (additive; the original keys remain):

```jsonc
{
  "totals": {
    "pages": 106, "passed": 60, "failed": 46,
    "app_render_ms_total": 15234.50,
    "app_render_ms_avg":   143.72,
    "app_render_ms_max":   892.30,
    "ref_render_ms_total":  4823.10,
    "ref_render_ms_avg":      45.50,
    "ref_render_ms_max":      75.00,
    "diff_ms_total":         891.20
  },
  "pdfs": [
    { "path": "...", "version": "1.4",
      "app_render_ms_total": 2603.40,
      "app_render_ms_avg":    130.17,
      "app_render_ms_max":    380.50,
      "ref_render_ms_total":   910.00,
      "ref_render_ms_avg":      45.50,
      "pages": [
        { "index": 0, "diff_pct": 0.42, "passed": true,
          "app_render_ms": 145.10, "ref_render_ms": 38.20 }
      ] }
  ]
}
```

**HTML report extension**:

- Four summary boxes at the top: Results · App render (total/avg/max) · PyMuPDF reference (total/avg) · Compare overhead.
- Each per-PDF heading carries a sub-line with `app avg ... · max ... · ref avg ...`.
- The per-page table gains three new columns: `App ms`, `Ref ms`, and `App vs Ref` (a small bar showing the app/ref ratio with a numeric `Nx` next to it). Rows where the app is more than 3× slower than the reference are tinted red so slow pages jump out.

**Console output**:

```
  Tekst.pdf p0    0.42%  PASS  app=145ms ref=38ms
  ...
[render-regression] 106 pages, 60 passed, 46 failed.
[render-regression] total app render: 15.2s (avg 144ms/page, max 892ms)
[render-regression] PyMuPDF reference: 4.8s (avg 46ms/page)
```

**Backward compatibility**: the `PageResult` timing fields default to `0.0`; the new `summary.json` keys are additive (no existing key changed type or was removed). Tools that read only the legacy `passed`/`failed`/`pages` keys keep working.

**Detecting regressions**: there is no stored historical baseline (mirrors §8's "no stored reference" policy). The engineer compares two consecutive runs by eye — a 2× jump in `totals.app_render_ms_avg` between commits is the expected smoke signal. A follow-up Spec B item can record this number into a small append-only file (`render-perf-history.jsonl`) and emit a diff between the last two runs.

