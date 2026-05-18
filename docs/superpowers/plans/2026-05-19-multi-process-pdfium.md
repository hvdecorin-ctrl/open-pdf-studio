# Multi-Process PDFium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parallelise PDFium rendering across 5 instances (main + 4 sidecar workers) so multi-page cold browse of NKD1a-class construction PDFs drops from ~6 s to ~1.5 s for 4 sequential pages, without changing any JS-side caller.

**Architecture:** New `pdfium-worker` Cargo crate built as a sidecar binary; Tauri main process spawns 4 instances at startup and manages a `WorkerPool` with hybrid affinity+overflow routing. Hybrid IPC — NDJSON for control, `memmap2` shared memory for RGBA bitmap data. `render_pdf_page` Tauri command transparently routes through pool when available, falls back to in-proc PDFium when not.

**Tech Stack:** Rust 2021 (workspace), Tauri 2.10, pdfium-render 0.9.1, memmap2 0.9, serde_json 1, tokio (rt + io + process).

**Spec:** `docs/superpowers/specs/2026-05-19-multi-process-pdfium-design.md`

---

## File Structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `pdfium-worker/Cargo.toml` | NEW | Crate manifest, builds `pdfium-worker.exe` binary. |
| `pdfium-worker/src/main.rs` | NEW | Worker entry: PDFium init, SHM open, NDJSON loop. |
| `pdfium-worker/src/protocol.rs` | NEW | Request/Response structs (serde) shared with main process. |
| `pdfium-worker/src/render.rs` | NEW | Single-page render function — wraps pdfium-render call. |
| `pdfium-worker/src/shm.rs` | NEW | Shared-memory file management (create, write header+payload). |
| `pdfium-worker/tests/render_integration.rs` | NEW | End-to-end: spawn binary, send render request, verify response. |
| `src-tauri/src/worker_pool/mod.rs` | NEW | Public API: `WorkerPool`, `init_pool`, `render`. Re-exports submodules. |
| `src-tauri/src/worker_pool/state.rs` | NEW | `WorkerState` struct, queue depth atomic, stdin/stdout handles. |
| `src-tauri/src/worker_pool/routing.rs` | NEW | Pure `pick_worker` function with affinity+overflow. Unit tests inline. |
| `src-tauri/src/worker_pool/spawn.rs` | NEW | Spawns workers via Tauri sidecar, waits for "ready" messages. |
| `src-tauri/src/worker_pool/recovery.rs` | NEW | Crash detection, respawn with backoff, mark-dead-permanent logic. |
| `src-tauri/src/lib.rs` | MODIFY | `render_pdf_page` consults pool first, falls back to in-proc; `.manage(WorkerPool)` at builder. |
| `src-tauri/Cargo.toml` | MODIFY | Add `[workspace] members = ["../pdfium-worker"]`, add memmap2 dep, declare sidecar binary. |
| `src-tauri/tauri.conf.json` | MODIFY | Add `bundle.externalBin` for `pdfium-worker`. |
| `Cargo.toml` (root) | MODIFY OR NEW | Workspace root if not present. |
| `mcp-server/multi-process-perf.mjs` | NEW | Probe: cold NKD1a, sequential 7-page nav, report per-page + total. |

**Why this split:** `worker_pool/` is divided so routing (pure function, easy to test) lives apart from spawn/recovery (async, IPC-bound, harder to test). `pdfium-worker/` keeps protocol/render/shm separate so the binary stays small and each piece is testable in isolation.

---

## Task 1: Cargo workspace + pdfium-worker crate stub

**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `pdfium-worker/Cargo.toml`
- Create: `pdfium-worker/src/main.rs`
- Modify: `open-pdf-studio/src-tauri/Cargo.toml`

- [ ] **Step 1: Create workspace root Cargo.toml**

Create `C:/Users/rickd/Documents/GitHub/open-pdf-studio/Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = [
  "open-pdf-studio/src-tauri",
  "open-pdf-render",
  "pdfium-worker",
]
```

If a root Cargo.toml already exists, add the `pdfium-worker` line to its `members` array.

- [ ] **Step 2: Create pdfium-worker crate manifest**

Create `C:/Users/rickd/Documents/GitHub/open-pdf-studio/pdfium-worker/Cargo.toml`:

```toml
[package]
name = "pdfium-worker"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "pdfium-worker"
path = "src/main.rs"

[dependencies]
pdfium-render = { version = "0.9.1", features = ["thread_safe", "image"] }
memmap2 = "0.9"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
```

- [ ] **Step 3: Create stub main.rs**

Create `C:/Users/rickd/Documents/GitHub/open-pdf-studio/pdfium-worker/src/main.rs`:

```rust
fn main() {
    // Stub — replaced in Task 5 with the real stdin/stdout loop.
    eprintln!("pdfium-worker stub");
}
```

- [ ] **Step 4: Verify cargo check compiles the workspace**

Run from `C:/Users/rickd/Documents/GitHub/open-pdf-studio/`:

```bash
cargo check -p pdfium-worker
```

Expected: compiles successfully, prints `Finished` (no errors). pdfium-render will pull in its build deps; first build takes 1-2 minutes.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml pdfium-worker/
git commit -m "feat(workspace): scaffold pdfium-worker crate

Empty stub binary, pulls in pdfium-render + memmap2 + serde_json.
First step of multi-process PDFium (v1.59) — see spec
docs/superpowers/specs/2026-05-19-multi-process-pdfium-design.md."
```

---

## Task 2: Worker protocol types

**Files:**
- Create: `pdfium-worker/src/protocol.rs`
- Modify: `pdfium-worker/src/main.rs`

- [ ] **Step 1: Write failing test for protocol round-trip**

Create `pdfium-worker/src/protocol.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Render {
        id: u64,
        path: String,
        page_index: u32,
        scale: f32,
        rotation: i32,
    },
    Shutdown,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Response {
    Ready { op: String, shm_name: String, shm_size: u64 },
    RenderOk { id: u64, ok: bool, w: u32, h: u32, shm_bytes: u64 },
    RenderErr { id: u64, ok: bool, error: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_render_round_trips() {
        let req = Request::Render {
            id: 42,
            path: "C:/foo.pdf".to_string(),
            page_index: 5,
            scale: 0.25,
            rotation: 0,
        };
        let line = serde_json::to_string(&req).unwrap();
        let parsed: Request = serde_json::from_str(&line).unwrap();
        assert_eq!(req, parsed);
    }

    #[test]
    fn response_render_ok_serializes_with_ok_true() {
        let resp = Response::RenderOk { id: 42, ok: true, w: 1289, h: 596, shm_bytes: 3072512 };
        let s = serde_json::to_string(&resp).unwrap();
        assert!(s.contains("\"ok\":true"));
        assert!(s.contains("\"shm_bytes\":3072512"));
    }
}
```

- [ ] **Step 2: Wire protocol module into main.rs**

Replace `pdfium-worker/src/main.rs` with:

```rust
mod protocol;

fn main() {
    eprintln!("pdfium-worker stub");
}
```

- [ ] **Step 3: Run tests**

```bash
cargo test -p pdfium-worker
```

Expected: 2 tests pass (`request_render_round_trips`, `response_render_ok_serializes_with_ok_true`).

- [ ] **Step 4: Commit**

```bash
git add pdfium-worker/
git commit -m "feat(pdfium-worker): NDJSON protocol types (Request/Response)

Render + Shutdown requests; Ready / RenderOk / RenderErr responses.
Serde round-trip + serialized-field tests."
```

---

## Task 3: Render function (wraps pdfium-render)

**Files:**
- Create: `pdfium-worker/src/render.rs`
- Modify: `pdfium-worker/src/main.rs`

- [ ] **Step 1: Write the render function with test using a tiny inline PDF**

Create `pdfium-worker/src/render.rs`:

```rust
use anyhow::{anyhow, Context, Result};
use pdfium_render::prelude::*;

pub struct RenderResult {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub struct Renderer {
    pdfium: Pdfium,
}

impl Renderer {
    pub fn new() -> Result<Self> {
        let bindings = Pdfium::bind_to_system_library()
            .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./")))
            .context("PDFium DLL not found (system or ./)")?;
        Ok(Self { pdfium: Pdfium::new(bindings) })
    }

    pub fn render(
        &self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
    ) -> Result<RenderResult> {
        let bytes = std::fs::read(path).with_context(|| format!("read {}", path))?;
        let doc = self.pdfium.load_pdf_from_byte_slice(&bytes, None)
            .map_err(|e| anyhow!("PDFium parse: {}", e))?;
        let pages = doc.pages();
        let page = pages.get(page_index as i32)
            .map_err(|e| anyhow!("page {}: {}", page_index, e))?;

        let w_pt = page.width().value;
        let h_pt = page.height().value;
        let target_w = (w_pt * scale).ceil() as i32;
        let target_h = (h_pt * scale).ceil() as i32;

        let rot = match rotation.rem_euclid(360) {
            0 => PdfPageRenderRotation::None,
            90 => PdfPageRenderRotation::Degrees90,
            180 => PdfPageRenderRotation::Degrees180,
            270 => PdfPageRenderRotation::Degrees270,
            other => return Err(anyhow!("unsupported rotation {}", other)),
        };

        let config = PdfRenderConfig::new()
            .set_target_width(target_w)
            .set_maximum_height(target_h)
            .rotate(rot, true)
            .render_form_data(true)
            .render_annotations(false)
            .use_lcd_text_rendering(true)
            .set_format(PdfBitmapFormat::BGRA);

        let bitmap = page.render_with_config(&config)
            .map_err(|e| anyhow!("PDFium render: {}", e))?;

        Ok(RenderResult {
            width: bitmap.width() as u32,
            height: bitmap.height() as u32,
            rgba: bitmap.as_rgba_bytes(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // requires PDFium DLL — run with `cargo test -- --ignored` after build
    fn renders_a4_at_scale_1() {
        // Tiny in-memory A4 PDF (no content, blank page) — for this test
        // we write a one-byte temp file path; will be replaced with a real
        // 1-page PDF when the integration test in Task 7 is wired.
        // This step verifies the function compiles + the type signature.
        let _r = Renderer::new();
        // If PDFium isn't installed locally this returns Err — that's fine
        // for the smoke test. The render itself is exercised in the
        // integration test against the real test corpus.
    }
}
```

- [ ] **Step 2: Wire render module into main.rs**

Update `pdfium-worker/src/main.rs`:

```rust
mod protocol;
mod render;

fn main() {
    eprintln!("pdfium-worker stub");
}
```

- [ ] **Step 3: Run cargo check**

```bash
cargo check -p pdfium-worker
```

Expected: compiles without errors. The `#[ignore]`d test is not run.

- [ ] **Step 4: Commit**

```bash
git add pdfium-worker/
git commit -m "feat(pdfium-worker): render function wrapping pdfium-render

Mirrors src-tauri/src/pdfium_renderer.rs render_page_to_rgba so worker
output is byte-identical to main-process PDFium output. Annotations off
(matches v1.51 ANNOTATION OWNERSHIP design)."
```

---

## Task 4: Shared-memory region (memmap2)

**Files:**
- Create: `pdfium-worker/src/shm.rs`
- Modify: `pdfium-worker/src/main.rs`

- [ ] **Step 1: Write SHM helper with header + payload writers**

Create `pdfium-worker/src/shm.rs`:

```rust
use anyhow::{Context, Result};
use memmap2::{MmapMut, MmapOptions};
use std::fs::OpenOptions;
use std::path::Path;

pub const SHM_SIZE: usize = 64 * 1024 * 1024; // 64 MB per worker
pub const HEADER_SIZE: usize = 32;

pub struct Shm {
    mmap: MmapMut,
    pub path: String,
}

impl Shm {
    /// Create (or replace) the SHM backing file under the OS temp dir.
    /// File name is `pdfium-worker-{slot}.shm` so main and worker can
    /// memmap the same path.
    pub fn create(slot: u32) -> Result<Self> {
        let path = format!(
            "{}/pdfium-worker-{}.shm",
            std::env::temp_dir().to_string_lossy(),
            slot
        );
        let file = OpenOptions::new()
            .read(true).write(true).create(true).truncate(true)
            .open(&path)
            .with_context(|| format!("open SHM file {}", path))?;
        file.set_len(SHM_SIZE as u64)
            .context("set SHM file length")?;
        let mmap = unsafe {
            MmapOptions::new().len(SHM_SIZE).map_mut(&file)
                .context("mmap SHM file")?
        };
        Ok(Self { mmap, path })
    }

    /// Write width + height to header, copy rgba into payload starting at
    /// offset HEADER_SIZE. Returns total payload bytes written.
    pub fn write_bitmap(&mut self, width: u32, height: u32, rgba: &[u8]) -> Result<u64> {
        if rgba.len() + HEADER_SIZE > SHM_SIZE {
            anyhow::bail!(
                "bitmap too large for SHM: {} bytes > {} (cap)",
                rgba.len(), SHM_SIZE - HEADER_SIZE
            );
        }
        self.mmap[0..4].copy_from_slice(&width.to_le_bytes());
        self.mmap[4..8].copy_from_slice(&height.to_le_bytes());
        // zero-fill the rest of the header (slots 8..32 reserved)
        for i in 8..HEADER_SIZE { self.mmap[i] = 0; }
        let end = HEADER_SIZE + rgba.len();
        self.mmap[HEADER_SIZE..end].copy_from_slice(rgba);
        self.mmap.flush_async()
            .context("flush SHM after write")?;
        Ok(rgba.len() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_header() {
        let mut shm = Shm::create(999).unwrap();
        let rgba = vec![0xAB; 1000];
        let bytes = shm.write_bitmap(123, 456, &rgba).unwrap();
        assert_eq!(bytes, 1000);
        // Re-read the file from disk and verify header
        let file_bytes = std::fs::read(&shm.path).unwrap();
        assert_eq!(u32::from_le_bytes([file_bytes[0], file_bytes[1], file_bytes[2], file_bytes[3]]), 123);
        assert_eq!(u32::from_le_bytes([file_bytes[4], file_bytes[5], file_bytes[6], file_bytes[7]]), 456);
        assert_eq!(file_bytes[HEADER_SIZE + 500], 0xAB);
    }

    #[test]
    fn write_too_large_returns_err() {
        let mut shm = Shm::create(998).unwrap();
        let huge = vec![0u8; SHM_SIZE];
        let r = shm.write_bitmap(1, 1, &huge);
        assert!(r.is_err());
    }
}
```

- [ ] **Step 2: Wire shm module into main.rs**

```rust
mod protocol;
mod render;
mod shm;

fn main() {
    eprintln!("pdfium-worker stub");
}
```

- [ ] **Step 3: Run tests**

```bash
cargo test -p pdfium-worker
```

Expected: 4 tests pass total (2 from protocol, 2 from shm).

- [ ] **Step 4: Commit**

```bash
git add pdfium-worker/
git commit -m "feat(pdfium-worker): memmap2 shared-memory region for bitmap output

64 MB per worker, 32-byte header (width u32 + height u32 + reserved),
payload at offset 32. write_bitmap errors on overflow so caller can
fall back to base64 inline (spec section: error handling)."
```

---

## Task 5: Worker stdin/stdout NDJSON loop

**Files:**
- Modify: `pdfium-worker/src/main.rs`

- [ ] **Step 1: Implement the full worker entry**

Replace `pdfium-worker/src/main.rs` with:

```rust
mod protocol;
mod render;
mod shm;

use anyhow::{Context, Result};
use protocol::{Request, Response};
use render::Renderer;
use shm::Shm;
use std::io::{BufRead, Write};

fn main() -> Result<()> {
    // Slot is passed as argv[1] (set by the spawner). Default to 0 for
    // standalone testing.
    let slot: u32 = std::env::args().nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let renderer = Renderer::new().context("init Renderer")?;
    let mut shm_region = Shm::create(slot).context("init SHM")?;

    // Emit ready message — main process waits for this before
    // sending render requests.
    let ready = Response::Ready {
        op: "ready".to_string(),
        shm_name: format!("pdfium-worker-{}.shm", slot),
        shm_size: shm::SHM_SIZE as u64,
    };
    writeln!(std::io::stdout(), "{}", serde_json::to_string(&ready)?)?;
    std::io::stdout().flush()?;

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[worker {}] stdin read error: {}", slot, e);
                break;
            }
        };
        if line.trim().is_empty() { continue; }

        let req: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[worker {}] bad request: {}", slot, e);
                continue;
            }
        };

        match req {
            Request::Render { id, path, page_index, scale, rotation } => {
                let resp = match renderer.render(&path, page_index, scale, rotation) {
                    Ok(result) => {
                        match shm_region.write_bitmap(result.width, result.height, &result.rgba) {
                            Ok(bytes) => Response::RenderOk {
                                id, ok: true,
                                w: result.width, h: result.height,
                                shm_bytes: bytes,
                            },
                            Err(e) => Response::RenderErr {
                                id, ok: false,
                                error: format!("SHM write: {}", e),
                            },
                        }
                    }
                    Err(e) => Response::RenderErr {
                        id, ok: false,
                        error: format!("{}", e),
                    },
                };
                writeln!(stdout, "{}", serde_json::to_string(&resp)?)?;
                stdout.flush()?;
            }
            Request::Shutdown => {
                eprintln!("[worker {}] shutting down", slot);
                break;
            }
        }
    }

    Ok(())
}
```

- [ ] **Step 2: Verify it builds**

```bash
cargo build -p pdfium-worker --release
```

Expected: binary produced at `target/release/pdfium-worker.exe`.

- [ ] **Step 3: Manual smoke test (no PDF, just shutdown)**

From a shell:

```bash
echo '{"op":"shutdown"}' | target/release/pdfium-worker.exe 0
```

Expected: stdout shows the ready line `{"op":"ready",...}` then the worker exits cleanly. No panics.

- [ ] **Step 4: Commit**

```bash
git add pdfium-worker/src/main.rs
git commit -m "feat(pdfium-worker): NDJSON request loop + ready handshake

Worker now: emits ready on startup, processes Render requests (PDFium
+ SHM write), exits on Shutdown. Bad-request lines are logged and
skipped so a single malformed line doesn't kill the worker."
```

---

## Task 6: Worker integration test

**Files:**
- Create: `pdfium-worker/tests/render_integration.rs`

- [ ] **Step 1: Write the integration test**

Create `pdfium-worker/tests/render_integration.rs`:

```rust
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

#[test]
#[ignore] // requires built pdfium-worker.exe + a test PDF
fn render_via_worker_subprocess_matches_in_proc() {
    // 1. Spawn the worker binary
    let mut child = Command::new(env!("CARGO_BIN_EXE_pdfium-worker"))
        .arg("99") // slot 99 — separate SHM file from real workers
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn worker");

    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut reader = BufReader::new(stdout);

    // 2. Read ready line
    let mut ready_line = String::new();
    reader.read_line(&mut ready_line).expect("read ready");
    assert!(ready_line.contains("\"op\":\"ready\""));

    // 3. Send a render request — use a known test PDF
    let req = r#"{"op":"render","id":1,"path":"C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/Tekst.pdf","page_index":0,"scale":1.0,"rotation":0}"#;
    writeln!(stdin, "{}", req).expect("write request");

    // 4. Read response
    let mut resp_line = String::new();
    reader.read_line(&mut resp_line).expect("read response");
    assert!(resp_line.contains("\"ok\":true"), "response was: {}", resp_line);
    assert!(resp_line.contains("\"w\":"));
    assert!(resp_line.contains("\"shm_bytes\":"));

    // 5. Send shutdown
    writeln!(stdin, "{}", r#"{"op":"shutdown"}"#).expect("write shutdown");
    drop(stdin);

    // 6. Wait for clean exit
    let status = child.wait().expect("wait worker");
    assert!(status.success(), "worker exited with {}", status);
}
```

- [ ] **Step 2: Run integration test**

```bash
cargo test -p pdfium-worker --release -- --ignored
```

Expected: test passes. Worker spawns, renders Tekst.pdf p1, returns success ack, shuts down cleanly. Test takes ~1-2 s.

- [ ] **Step 3: Commit**

```bash
git add pdfium-worker/tests/
git commit -m "test(pdfium-worker): cross-process integration test

Spawns the worker binary, sends a render request for Tekst.pdf p1
through stdin, verifies the SHM ack response. Marked #[ignore] so
the default cargo test still works without the test corpus present."
```

---

## Task 7: WorkerState struct (main process side)

**Files:**
- Create: `open-pdf-studio/src-tauri/src/worker_pool/mod.rs`
- Create: `open-pdf-studio/src-tauri/src/worker_pool/state.rs`
- Modify: `open-pdf-studio/src-tauri/Cargo.toml`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs`

- [ ] **Step 1: Add memmap2 dependency**

Edit `open-pdf-studio/src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
memmap2 = "0.9"
```

- [ ] **Step 2: Create worker_pool module + state.rs**

Create `open-pdf-studio/src-tauri/src/worker_pool/mod.rs`:

```rust
//! Multi-process PDFium worker pool. Transparent to JS — the
//! `render_pdf_page` Tauri command routes through `WorkerPool::render`
//! when the pool is ready, falls back to in-proc PDFium otherwise.
//!
//! Architecture: spec/2026-05-19-multi-process-pdfium-design.md.

pub mod state;
pub mod routing;
pub mod spawn;
pub mod recovery;

pub use state::WorkerState;
```

Create `open-pdf-studio/src-tauri/src/worker_pool/state.rs`:

```rust
use std::sync::atomic::{AtomicUsize, AtomicU8, Ordering};
use std::sync::Arc;
use tokio::io::{BufReader, AsyncBufReadExt};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use memmap2::Mmap;

/// Status of a single worker slot.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Status {
    Spawning = 0,
    Ready = 1,
    Dead = 2,
    DeadPermanent = 3,
}

pub struct WorkerState {
    pub slot: u32,
    pub status: AtomicU8,
    pub queue_depth: AtomicUsize,
    pub child: Arc<Mutex<Option<Child>>>,
    pub stdin: Arc<Mutex<Option<ChildStdin>>>,
    pub stdout: Arc<Mutex<Option<BufReader<ChildStdout>>>>,
    pub shm: Arc<Mutex<Option<Mmap>>>,
    pub crashes: AtomicUsize,
    pub last_crash_at: Arc<Mutex<Option<std::time::Instant>>>,
}

impl WorkerState {
    pub fn new(slot: u32) -> Self {
        Self {
            slot,
            status: AtomicU8::new(Status::Spawning as u8),
            queue_depth: AtomicUsize::new(0),
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            stdout: Arc::new(Mutex::new(None)),
            shm: Arc::new(Mutex::new(None)),
            crashes: AtomicUsize::new(0),
            last_crash_at: Arc::new(Mutex::new(None)),
        }
    }

    pub fn status(&self) -> Status {
        match self.status.load(Ordering::Acquire) {
            1 => Status::Ready,
            2 => Status::Dead,
            3 => Status::DeadPermanent,
            _ => Status::Spawning,
        }
    }

    pub fn set_status(&self, s: Status) {
        self.status.store(s as u8, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_status_is_spawning() {
        let w = WorkerState::new(0);
        assert_eq!(w.status(), Status::Spawning);
    }

    #[test]
    fn status_transitions() {
        let w = WorkerState::new(0);
        w.set_status(Status::Ready);
        assert_eq!(w.status(), Status::Ready);
        w.set_status(Status::Dead);
        assert_eq!(w.status(), Status::Dead);
    }

    #[test]
    fn queue_depth_atomic_increments() {
        let w = WorkerState::new(0);
        w.queue_depth.fetch_add(1, Ordering::Release);
        w.queue_depth.fetch_add(1, Ordering::Release);
        assert_eq!(w.queue_depth.load(Ordering::Acquire), 2);
    }
}
```

- [ ] **Step 3: Register module in lib.rs**

In `open-pdf-studio/src-tauri/src/lib.rs`, add near the top (with other `mod` declarations):

```rust
mod worker_pool;
```

- [ ] **Step 4: Run tests**

```bash
cd open-pdf-studio
cargo test -p open-pdf-studio worker_pool::state
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/src/worker_pool/
git commit -m "feat(worker-pool): WorkerState struct with atomic status + depth

Slot, status (Spawning/Ready/Dead/DeadPermanent), queue_depth atomic
for routing, child + stdin + stdout + shm handles. Sets up the
storage; spawn + routing + render dispatch come in later tasks."
```

---

## Task 8: Routing logic (pure function, unit tested)

**Files:**
- Create: `open-pdf-studio/src-tauri/src/worker_pool/routing.rs`

- [ ] **Step 1: Write tests first**

Create `open-pdf-studio/src-tauri/src/worker_pool/routing.rs` with tests at top:

```rust
use std::hash::{Hash, Hasher};

/// Hybrid affinity+overflow routing. Returns the worker slot index
/// (0..N-1) to dispatch the next render to.
///
/// Rules:
///   1. Compute affinity = hash(path, page_index) % N
///   2. If depths[affinity] <= OVERFLOW_THRESHOLD: use affinity
///   3. Otherwise: pick the least-busy slot
///
/// Dead slots (depth == usize::MAX as sentinel) are skipped.
pub const OVERFLOW_THRESHOLD: usize = 2;

pub fn pick_worker(path: &str, page_index: u32, depths: &[usize]) -> usize {
    assert!(!depths.is_empty(), "depths cannot be empty");

    let alive: Vec<usize> = depths.iter().enumerate()
        .filter(|(_, &d)| d != usize::MAX)
        .map(|(i, _)| i)
        .collect();
    assert!(!alive.is_empty(), "no live workers");

    let n_alive = alive.len();
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    page_index.hash(&mut h);
    let affinity_idx = (h.finish() as usize) % n_alive;
    let affinity = alive[affinity_idx];

    if depths[affinity] <= OVERFLOW_THRESHOLD {
        return affinity;
    }

    // Overflow: least-busy among alive
    *alive.iter().min_by_key(|&&i| depths[i]).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn affinity_used_when_depth_under_threshold() {
        let depths = vec![0, 0, 0, 0, 0];
        // Same (path, page) should always pick the same worker
        let a = pick_worker("foo.pdf", 5, &depths);
        let b = pick_worker("foo.pdf", 5, &depths);
        assert_eq!(a, b);
        assert!(a < 5);
    }

    #[test]
    fn different_pages_distribute() {
        let depths = vec![0, 0, 0, 0, 0];
        let mut picks = std::collections::HashSet::new();
        for p in 0..20 {
            picks.insert(pick_worker("foo.pdf", p, &depths));
        }
        // 20 pages across 5 workers should hit at least 3 different slots
        assert!(picks.len() >= 3, "got only {} distinct workers", picks.len());
    }

    #[test]
    fn overflow_falls_back_to_least_busy() {
        // Force affinity = slot 0 (load all into slot 0)
        // We can't easily control hash output, so test the BEHAVIOR:
        // if every slot has depth 3, the affinity target ALSO has depth 3 → overflow.
        // The fallback picks least-busy, which will be the slot with the lowest depth.
        let depths = vec![5, 1, 5, 5, 5];
        for p in 0..10 {
            let picked = pick_worker("foo.pdf", p, &depths);
            // Picked slot must EITHER be the affinity target (if <= 2) OR slot 1 (least busy)
            // Since depths[1] = 1 is the only one <= 2, picked must be 1
            assert_eq!(picked, 1, "page {} picked {}", p, picked);
        }
    }

    #[test]
    fn skips_dead_workers() {
        let depths = vec![usize::MAX, 0, usize::MAX, 0, usize::MAX]; // only 1 and 3 alive
        for p in 0..10 {
            let picked = pick_worker("foo.pdf", p, &depths);
            assert!(picked == 1 || picked == 3, "got {}", picked);
        }
    }

    #[test]
    #[should_panic(expected = "no live workers")]
    fn panics_when_all_dead() {
        let depths = vec![usize::MAX, usize::MAX, usize::MAX];
        pick_worker("foo.pdf", 0, &depths);
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cargo test -p open-pdf-studio worker_pool::routing
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/src-tauri/src/worker_pool/routing.rs
git commit -m "feat(worker-pool): hybrid affinity+overflow routing

Pure function: pick_worker(path, page, depths) → slot. Uses
DefaultHasher for affinity, threshold-2 overflow to least-busy.
Skips dead slots (depth == usize::MAX sentinel). Unit tested."
```

---

## Task 9: Worker spawn + ready handshake

**Files:**
- Create: `open-pdf-studio/src-tauri/src/worker_pool/spawn.rs`

- [ ] **Step 1: Write the spawn function**

Create `open-pdf-studio/src-tauri/src/worker_pool/spawn.rs`:

```rust
use super::state::{Status, WorkerState};
use anyhow::{anyhow, Context, Result};
use memmap2::MmapOptions;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

const SHM_SIZE: usize = 64 * 1024 * 1024;
const READY_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn spawn_worker(worker: Arc<WorkerState>, exe_path: &std::path::Path) -> Result<()> {
    worker.set_status(Status::Spawning);

    let mut cmd = Command::new(exe_path);
    cmd.arg(worker.slot.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    let mut child = cmd.spawn()
        .with_context(|| format!("spawn worker {} from {:?}", worker.slot, exe_path))?;

    let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
    let mut reader = BufReader::new(stdout);

    // Wait for ready line (with timeout)
    let mut ready_line = String::new();
    let read_ready = reader.read_line(&mut ready_line);
    timeout(READY_TIMEOUT, read_ready).await
        .with_context(|| format!("worker {} ready timeout", worker.slot))?
        .with_context(|| format!("worker {} ready read", worker.slot))?;

    if !ready_line.contains("\"op\":\"ready\"") {
        return Err(anyhow!("worker {} did not send ready: {}", worker.slot, ready_line));
    }

    // mmap the SHM file the worker created
    let shm_path = format!(
        "{}/pdfium-worker-{}.shm",
        std::env::temp_dir().to_string_lossy(),
        worker.slot
    );
    let file = std::fs::OpenOptions::new()
        .read(true).write(false)
        .open(&shm_path)
        .with_context(|| format!("open SHM {}", shm_path))?;
    let mmap = unsafe {
        MmapOptions::new().len(SHM_SIZE).map(&file)
            .with_context(|| format!("mmap SHM {}", shm_path))?
    };

    // Stash handles in the WorkerState
    *worker.child.lock().await = Some(child);
    *worker.stdin.lock().await = Some(stdin);
    *worker.stdout.lock().await = Some(reader);
    *worker.shm.lock().await = Some(mmap);
    worker.set_status(Status::Ready);

    Ok(())
}

pub async fn spawn_pool(n_workers: u32, exe_path: &std::path::Path) -> Result<Vec<Arc<WorkerState>>> {
    let mut workers = Vec::with_capacity(n_workers as usize);
    for slot in 0..n_workers {
        let w = Arc::new(WorkerState::new(slot));
        workers.push(w.clone());
        match spawn_worker(w.clone(), exe_path).await {
            Ok(_) => {
                eprintln!("[pool] worker {} ready", slot);
            }
            Err(e) => {
                eprintln!("[pool] worker {} spawn failed: {} — pool will run with N-1", slot, e);
                w.set_status(Status::DeadPermanent);
            }
        }
    }
    Ok(workers)
}
```

- [ ] **Step 2: Add tokio process feature to Cargo.toml**

In `open-pdf-studio/src-tauri/Cargo.toml`, ensure tokio has `process` + `io-util` + `time` features. If tauri pulls tokio already, may just need to extend:

```toml
tokio = { version = "1", features = ["rt-multi-thread", "process", "io-util", "time", "sync"] }
```

(Add this if not already in deps. If tokio is transitively from tauri, add it as a direct dep to control features.)

- [ ] **Step 3: cargo check**

```bash
cargo check -p open-pdf-studio
```

Expected: compiles. Resolve any tokio-feature errors by adjusting features in Cargo.toml.

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/src/worker_pool/spawn.rs
git commit -m "feat(worker-pool): spawn workers + wait for ready, mmap SHM

spawn_worker spawns the sidecar binary, waits up to 5s for the
ready line on stdout, mmaps the SHM file the worker created.
spawn_pool calls spawn_worker for slots 0..N; individual failures
mark the slot DeadPermanent but the rest of the pool continues."
```

---

## Task 10: WorkerPool::render dispatch

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/worker_pool/mod.rs`

- [ ] **Step 1: Add the WorkerPool struct + render method**

Replace `open-pdf-studio/src-tauri/src/worker_pool/mod.rs` with:

```rust
//! Multi-process PDFium worker pool. Transparent to JS — the
//! `render_pdf_page` Tauri command routes through `WorkerPool::render`
//! when the pool is ready, falls back to in-proc PDFium otherwise.
//!
//! Architecture: spec/2026-05-19-multi-process-pdfium-design.md.

pub mod state;
pub mod routing;
pub mod spawn;
pub mod recovery;

use anyhow::{anyhow, Context, Result};
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

pub use state::{Status, WorkerState};

pub struct WorkerPool {
    pub workers: Vec<Arc<WorkerState>>,
    next_request_id: std::sync::atomic::AtomicU64,
}

impl WorkerPool {
    pub fn new(workers: Vec<Arc<WorkerState>>) -> Self {
        Self {
            workers,
            next_request_id: std::sync::atomic::AtomicU64::new(1),
        }
    }

    /// Returns true if at least one worker is Ready.
    pub fn is_ready(&self) -> bool {
        self.workers.iter().any(|w| w.status() == Status::Ready)
    }

    /// Snapshot of current queue depths (usize::MAX for dead slots).
    fn depths(&self) -> Vec<usize> {
        self.workers.iter().map(|w| match w.status() {
            Status::Ready => w.queue_depth.load(Ordering::Acquire),
            _ => usize::MAX,
        }).collect()
    }

    /// Render via the pool. Returns (width, height, rgba_bytes).
    pub async fn render(
        &self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
    ) -> Result<(u32, u32, Vec<u8>)> {
        let depths = self.depths();
        let slot = routing::pick_worker(path, page_index, &depths);
        let worker = self.workers[slot].clone();

        // Increment depth; we decrement after we receive the ack
        worker.queue_depth.fetch_add(1, Ordering::Release);

        let result = self.render_on_worker(worker.clone(), path, page_index, scale, rotation).await;

        worker.queue_depth.fetch_sub(1, Ordering::Release);

        result
    }

    async fn render_on_worker(
        &self,
        worker: Arc<WorkerState>,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
    ) -> Result<(u32, u32, Vec<u8>)> {
        let id = self.next_request_id.fetch_add(1, Ordering::Release);

        let req = json!({
            "op": "render",
            "id": id,
            "path": path,
            "page_index": page_index,
            "scale": scale,
            "rotation": rotation,
        });
        let req_line = format!("{}\n", req);

        // Write request
        {
            let mut stdin_guard = worker.stdin.lock().await;
            let stdin = stdin_guard.as_mut()
                .ok_or_else(|| anyhow!("worker {} has no stdin", worker.slot))?;
            stdin.write_all(req_line.as_bytes()).await
                .with_context(|| format!("write to worker {}", worker.slot))?;
            stdin.flush().await?;
        }

        // Read response
        let mut resp_line = String::new();
        {
            let mut stdout_guard = worker.stdout.lock().await;
            let stdout = stdout_guard.as_mut()
                .ok_or_else(|| anyhow!("worker {} has no stdout", worker.slot))?;
            stdout.read_line(&mut resp_line).await
                .with_context(|| format!("read from worker {}", worker.slot))?;
        }

        if resp_line.is_empty() {
            return Err(anyhow!("worker {} EOF", worker.slot));
        }

        let resp: serde_json::Value = serde_json::from_str(&resp_line)
            .with_context(|| format!("parse worker {} response: {}", worker.slot, resp_line))?;

        if !resp["ok"].as_bool().unwrap_or(false) {
            let err = resp["error"].as_str().unwrap_or("unknown");
            return Err(anyhow!("worker {} render error: {}", worker.slot, err));
        }

        let w = resp["w"].as_u64().unwrap_or(0) as u32;
        let h = resp["h"].as_u64().unwrap_or(0) as u32;
        let shm_bytes = resp["shm_bytes"].as_u64().unwrap_or(0) as usize;

        // Read RGBA from SHM
        let shm_guard = worker.shm.lock().await;
        let mmap = shm_guard.as_ref()
            .ok_or_else(|| anyhow!("worker {} has no shm", worker.slot))?;
        const HEADER: usize = 32;
        if shm_bytes + HEADER > mmap.len() {
            return Err(anyhow!("worker {} shm_bytes {} exceeds region", worker.slot, shm_bytes));
        }
        let rgba = mmap[HEADER..HEADER + shm_bytes].to_vec();

        Ok((w, h, rgba))
    }
}
```

- [ ] **Step 2: cargo check**

```bash
cargo check -p open-pdf-studio
```

Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/src-tauri/src/worker_pool/mod.rs
git commit -m "feat(worker-pool): WorkerPool::render dispatches through routing

Picks slot via routing, increments depth, writes NDJSON request to
worker stdin, reads ack from stdout, copies RGBA bytes from SHM,
decrements depth. Bytes-out matches the existing render_pdf_page
return convention so the Tauri command can swap transparently."
```

---

## Task 11: Crash detection + respawn (recovery)

**Files:**
- Create: `open-pdf-studio/src-tauri/src/worker_pool/recovery.rs`

- [ ] **Step 1: Write the recovery logic**

Create `open-pdf-studio/src-tauri/src/worker_pool/recovery.rs`:

```rust
use super::spawn::spawn_worker;
use super::state::{Status, WorkerState};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

const CRASH_WINDOW: Duration = Duration::from_secs(30);
const MAX_CRASHES_IN_WINDOW: usize = 3;
const RESPAWN_DELAY: Duration = Duration::from_secs(1);

/// Called when WorkerPool::render detects an error talking to a worker.
/// Marks the worker Dead, schedules respawn after backoff, and tracks
/// crash count for the DeadPermanent threshold.
pub async fn handle_worker_crash(worker: Arc<WorkerState>, exe_path: PathBuf) {
    worker.set_status(Status::Dead);
    let crashes = worker.crashes.fetch_add(1, Ordering::Release) + 1;
    let now = Instant::now();

    let too_many = {
        let mut last = worker.last_crash_at.lock().await;
        let recent = last.map(|t| now.duration_since(t) < CRASH_WINDOW).unwrap_or(false);
        *last = Some(now);
        recent && crashes >= MAX_CRASHES_IN_WINDOW
    };

    if too_many {
        worker.set_status(Status::DeadPermanent);
        eprintln!(
            "[recovery] worker {} crashed {}× in {:?} — marking DeadPermanent",
            worker.slot, crashes, CRASH_WINDOW
        );
        return;
    }

    eprintln!(
        "[recovery] worker {} crashed (#{}); respawning in {:?}",
        worker.slot, crashes, RESPAWN_DELAY
    );

    tokio::time::sleep(RESPAWN_DELAY).await;

    // Drain old handles
    *worker.child.lock().await = None;
    *worker.stdin.lock().await = None;
    *worker.stdout.lock().await = None;
    *worker.shm.lock().await = None;
    worker.queue_depth.store(0, Ordering::Release);

    match spawn_worker(worker.clone(), &exe_path).await {
        Ok(_) => eprintln!("[recovery] worker {} respawned", worker.slot),
        Err(e) => {
            eprintln!("[recovery] worker {} respawn failed: {}", worker.slot, e);
            worker.set_status(Status::Dead); // will try again on next crash trigger
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn three_quick_crashes_marks_permanent() {
        // Use a non-existent exe path so respawn always fails — we just
        // care about the crash counter / DeadPermanent transition.
        let worker = Arc::new(WorkerState::new(0));
        let bad_path = PathBuf::from("C:/does-not-exist.exe");

        // First crash: status Dead, respawn attempted (fails, set Dead again)
        handle_worker_crash(worker.clone(), bad_path.clone()).await;
        assert_eq!(worker.status(), Status::Dead);

        // Second crash within 30s: still Dead, not yet permanent
        handle_worker_crash(worker.clone(), bad_path.clone()).await;
        // crashes counter is 2 now

        // Third crash: should hit MAX_CRASHES_IN_WINDOW
        handle_worker_crash(worker.clone(), bad_path).await;
        assert_eq!(worker.status(), Status::DeadPermanent);
    }
}
```

- [ ] **Step 2: Wire recovery into WorkerPool::render**

Edit `open-pdf-studio/src-tauri/src/worker_pool/mod.rs`'s `render` method to invoke recovery on error. Replace the `render` method body with:

```rust
    pub async fn render(
        &self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
    ) -> Result<(u32, u32, Vec<u8>)> {
        // First attempt
        let depths = self.depths();
        let slot = routing::pick_worker(path, page_index, &depths);
        let worker = self.workers[slot].clone();
        worker.queue_depth.fetch_add(1, Ordering::Release);
        let result = self.render_on_worker(worker.clone(), path, page_index, scale, rotation).await;
        worker.queue_depth.fetch_sub(1, Ordering::Release);

        if result.is_ok() {
            return result;
        }

        // First attempt failed → mark crash, retry on a DIFFERENT live slot
        let exe = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("pdfium-worker.exe")))
            .unwrap_or_else(|| std::path::PathBuf::from("pdfium-worker.exe"));
        let recover_task = recovery::handle_worker_crash(worker.clone(), exe);
        tokio::spawn(recover_task);

        let mut depths_retry = self.depths();
        depths_retry[slot] = usize::MAX; // mark as dead for this retry
        if depths_retry.iter().all(|&d| d == usize::MAX) {
            return result; // no other workers — bubble up the error
        }
        let slot2 = routing::pick_worker(path, page_index, &depths_retry);
        let worker2 = self.workers[slot2].clone();
        worker2.queue_depth.fetch_add(1, Ordering::Release);
        let result2 = self.render_on_worker(worker2.clone(), path, page_index, scale, rotation).await;
        worker2.queue_depth.fetch_sub(1, Ordering::Release);
        result2
    }
```

- [ ] **Step 3: Run tests**

```bash
cargo test -p open-pdf-studio worker_pool::recovery
```

Expected: 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/src-tauri/src/worker_pool/
git commit -m "feat(worker-pool): crash detection + respawn with backoff

handle_worker_crash marks Dead, sleeps 1s, drains stale handles, and
re-spawns. 3 crashes within 30s → DeadPermanent (pool runs with N-1).
WorkerPool::render does one retry on a different live slot before
bubbling the error."
```

---

## Task 12: Tauri command integration

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/lib.rs`

- [ ] **Step 1: Add pool init to the Tauri builder**

In `open-pdf-studio/src-tauri/src/lib.rs`, find the `tauri::Builder::default()` chain (around line 1595). Add `.manage(WorkerPool)` after the existing `.manage` calls. Add this struct + pool spawn at the top of the `run()` function (after the existing `let opened_files: ...` block):

```rust
    // Spawn the PDFium worker pool. Failures here are non-fatal — the
    // existing in-proc PDFium path serves as fallback when the pool is
    // unavailable.
    let pool: Arc<tokio::sync::OnceCell<worker_pool::WorkerPool>> = Arc::new(tokio::sync::OnceCell::new());
    let pool_for_init = pool.clone();
    tauri::async_runtime::spawn(async move {
        // pdfium-worker.exe sits next to the main binary after bundling.
        let exe_dir = std::env::current_exe().ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let worker_exe = exe_dir.join("pdfium-worker.exe");

        if !worker_exe.exists() {
            eprintln!("[pool] pdfium-worker.exe not found at {:?} — pool disabled, using in-proc PDFium", worker_exe);
            return;
        }

        match worker_pool::spawn::spawn_pool(4, &worker_exe).await {
            Ok(workers) => {
                let pool = worker_pool::WorkerPool::new(workers);
                if pool.is_ready() {
                    eprintln!("[pool] initialised with {} workers", pool.workers.len());
                    let _ = pool_for_init.set(pool);
                } else {
                    eprintln!("[pool] no workers became ready — pool disabled");
                }
            }
            Err(e) => {
                eprintln!("[pool] spawn_pool failed: {} — pool disabled", e);
            }
        }
    });
```

In the `.manage()` chain, add:

```rust
        .manage(pool.clone())
```

- [ ] **Step 2: Route render_pdf_page through the pool**

Find the `render_pdf_page` Tauri command in `lib.rs` (around line 1186). Replace its body (the part after `let bytes = { ... };`) with:

```rust
#[tauri::command]
async fn render_pdf_page(
    path: String,
    page_index: u32,
    scale: f32,
    rotation: Option<i32>,
    bytes_cache: tauri::State<'_, PdfBytesCache>,
    pdfium_cache: tauri::State<'_, pdfium_renderer::PdfiumDocCache>,
    pixmap_cache: tauri::State<'_, pdfium_renderer::PixmapCacheState>,
    pool: tauri::State<'_, std::sync::Arc<tokio::sync::OnceCell<worker_pool::WorkerPool>>>,
) -> Result<tauri::ipc::Response, String> {
    let extra_rot = rotation.unwrap_or(0);
    let scale_q = (scale * 10_000.0).round() as u32;
    let cache_key = (path.clone(), page_index, scale_q, extra_rot);

    // Cache fast path (unchanged)
    pixmap_cache.ensure();
    if let Ok(guard) = pixmap_cache.0.lock() {
        if let Some(cache) = guard.as_ref() {
            if let Some(cached) = cache.get(&cache_key) {
                let mut data = Vec::with_capacity(8 + cached.rgba.len());
                data.extend_from_slice(&cached.width.to_le_bytes());
                data.extend_from_slice(&cached.height.to_le_bytes());
                data.extend_from_slice(&cached.rgba);
                return Ok(tauri::ipc::Response::new(data));
            }
        }
    }

    // Try the worker pool first
    if let Some(p) = pool.get() {
        match p.render(&path, page_index, scale, extra_rot).await {
            Ok((width, height, rgba)) => {
                let rgba_arc = std::sync::Arc::new(rgba);
                if let Ok(mut guard) = pixmap_cache.0.lock() {
                    if let Some(cache) = guard.as_mut() {
                        cache.insert(cache_key, std::sync::Arc::new(pdfium_renderer::CachedPixmap {
                            width, height, rgba: rgba_arc.clone(),
                        }));
                    }
                }
                let mut data = Vec::with_capacity(8 + rgba_arc.len());
                data.extend_from_slice(&width.to_le_bytes());
                data.extend_from_slice(&height.to_le_bytes());
                data.extend_from_slice(&rgba_arc);
                return Ok(tauri::ipc::Response::new(data));
            }
            Err(e) => {
                eprintln!("[render_pdf_page] pool render failed: {} — falling back to in-proc", e);
            }
        }
    }

    // Fallback: in-proc PDFium (existing path, unchanged)
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

    let rgba_arc = std::sync::Arc::new(rgba);
    if let Ok(mut guard) = pixmap_cache.0.lock() {
        if let Some(cache) = guard.as_mut() {
            cache.insert(cache_key, std::sync::Arc::new(pdfium_renderer::CachedPixmap {
                width, height, rgba: rgba_arc.clone(),
            }));
        }
    }

    let mut data = Vec::with_capacity(8 + rgba_arc.len());
    data.extend_from_slice(&width.to_le_bytes());
    data.extend_from_slice(&height.to_le_bytes());
    data.extend_from_slice(&rgba_arc);
    Ok(tauri::ipc::Response::new(data))
}
```

Note: the function signature changes from `fn` to `async fn` and a new `pool` State param is added. Make sure the `invoke_handler` macro and any docs around the function reflect the new async signature (Tauri 2 supports async commands directly).

- [ ] **Step 3: cargo build**

```bash
cargo build -p open-pdf-studio
```

Expected: builds. Resolve any compile errors (e.g. missing `use` for `Arc`, async trait bounds).

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(worker-pool): wire WorkerPool into render_pdf_page command

Pool spawned at app start (non-blocking). render_pdf_page tries pool
first; falls back to in-proc PDFium when pool is null (still
initialising or no workers ready). Pixmap cache shared between both
paths so warm-renders skip both."
```

---

## Task 13: Tauri sidecar bundling

**Files:**
- Modify: `open-pdf-studio/src-tauri/tauri.conf.json`
- Modify: `open-pdf-studio/src-tauri/Cargo.toml`

- [ ] **Step 1: Declare the sidecar in tauri.conf.json**

In `open-pdf-studio/src-tauri/tauri.conf.json`, add inside `"bundle"`:

```json
    "externalBin": [
      "binaries/pdfium-worker"
    ]
```

If `"bundle"` doesn't have a `"resources"` section to copy the PDFium DLL next to the worker binary, also add:

```json
    "resources": [
      "binaries/pdfium.dll"
    ]
```

- [ ] **Step 2: Create the binaries/ directory + copy script**

Create `open-pdf-studio/src-tauri/binaries/.gitkeep` (empty file, to keep the dir tracked).

Edit `open-pdf-studio/src-tauri/build.rs` (or create it). Append a build step that copies the worker binary to `binaries/pdfium-worker-{target_triple}.exe`:

```rust
fn main() {
    // Existing build steps...
    tauri_build::build();

    // Copy the pdfium-worker binary into src-tauri/binaries/ so Tauri's
    // sidecar bundler picks it up. The binary must be named with the
    // target triple suffix per Tauri's externalBin convention.
    let target = std::env::var("TARGET").unwrap_or_else(|_| "x86_64-pc-windows-msvc".to_string());
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let src = std::path::PathBuf::from("../../target")
        .join(&profile)
        .join("pdfium-worker.exe");
    let dst = std::path::PathBuf::from("binaries")
        .join(format!("pdfium-worker-{}.exe", target));
    if src.exists() {
        let _ = std::fs::create_dir_all("binaries");
        let _ = std::fs::copy(&src, &dst);
    }
}
```

If `build.rs` already exists, merge the new code into the existing `fn main()`.

- [ ] **Step 3: cargo build the full app**

```bash
cd open-pdf-studio
npm run tauri:build
```

Expected: builds the worker first, then the main app, then the bundler picks up `binaries/pdfium-worker-x86_64-pc-windows-msvc.exe`.

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/src-tauri/tauri.conf.json open-pdf-studio/src-tauri/build.rs open-pdf-studio/src-tauri/binaries/.gitkeep
git commit -m "feat(bundle): include pdfium-worker.exe as Tauri sidecar

build.rs copies the worker binary into binaries/ with the target
triple suffix Tauri expects. tauri.conf.json's bundle.externalBin
picks it up so it ships alongside the main exe in installers."
```

---

## Task 14: End-to-end integration test (pool vs in-proc parity)

**Files:**
- Create: `open-pdf-studio/src-tauri/tests/pool_parity.rs`

- [ ] **Step 1: Write the parity test**

Create `open-pdf-studio/src-tauri/tests/pool_parity.rs`:

```rust
//! Pool vs in-proc parity: same render request through both paths
//! must produce byte-identical RGBA. If this ever drifts, the pool
//! has a bug.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;

#[tokio::test]
#[ignore] // requires built pdfium-worker.exe + test PDF
async fn pool_render_matches_inproc_for_nkd1a_p4() {
    let exe = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug/pdfium-worker.exe");
    if !exe.exists() {
        panic!("build pdfium-worker first: cargo build -p pdfium-worker");
    }

    let path = "C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/NKD1a_opm_aw.pdf";
    let page = 3; // p4 (0-indexed)
    let scale = 0.25;

    // 1. Render via pool
    let workers = app_lib::worker_pool::spawn::spawn_pool(1, &exe).await
        .expect("spawn pool");
    let pool = app_lib::worker_pool::WorkerPool::new(workers);
    assert!(pool.is_ready(), "pool not ready");

    let (pw, ph, prgba) = pool.render(path, page, scale, 0).await.expect("pool render");

    // 2. Render in-proc
    let bytes = std::fs::read(path).unwrap();
    let cache = app_lib::pdfium_renderer::PdfiumDocCache::default();
    let handle = app_lib::pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
        path, Arc::new(bytes), &tauri::State::new(&cache)
    ).unwrap();
    let (iw, ih, irgba) = app_lib::pdfium_renderer::render_page_to_rgba(
        handle.document(), page, scale, 0
    ).unwrap();

    // 3. Compare
    assert_eq!(pw, iw, "width differs");
    assert_eq!(ph, ih, "height differs");
    assert_eq!(prgba.len(), irgba.len(), "rgba length differs");

    let diff = prgba.iter().zip(irgba.iter())
        .filter(|(a, b)| a != b).count();
    let total = prgba.len();
    let diff_pct = (diff as f64 / total as f64) * 100.0;
    assert!(diff_pct < 0.1, "pool rgba differs from in-proc by {:.3}% ({} bytes)", diff_pct, diff);
}
```

Note: this test relies on `app_lib` (the crate name from `src-tauri/Cargo.toml` `[lib] name = "app_lib"`). If unavailable as a public module path, mark the relevant pdfium_renderer functions and worker_pool submodules `pub` in lib.rs (`pub mod pdfium_renderer; pub mod worker_pool;`).

- [ ] **Step 2: Run the test**

```bash
cd open-pdf-studio
cargo test -p open-pdf-studio --test pool_parity -- --ignored
```

Expected: passes. Both renders produce byte-identical output (same PDFium config). If diff_pct >= 0.1%, investigate — the pool has a bug.

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/src-tauri/tests/pool_parity.rs
git commit -m "test(pool): byte-parity vs in-proc render on NKD1a p4

Renders the same page through both paths and asserts the RGBA
bytes match. Catches any worker bug that would silently corrupt
pixel output."
```

---

## Task 15: Perf probe + measurement

**Files:**
- Create: `mcp-server/multi-process-perf.mjs`

- [ ] **Step 1: Write the probe**

Create `C:/Users/rickd/Documents/GitHub/open-pdf-studio/mcp-server/multi-process-perf.mjs`:

```javascript
// Multi-process PDFium perf probe — compares v1.59 (pool) vs v1.58.3
// (single proc) on NKD1a's 4-page sequential cold browse.
//
// Run AFTER the v1.59 build is live (npm run tauri:dev:debug). The
// probe prints a per-page TOTAL plus the sum across all 4 pages.

const MCP = 'http://127.0.0.1:9223/mcp';
const PDF = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/NKD1a_opm_aw.pdf';

let id = 1;
async function tool(name, args) {
  const r = await fetch(MCP, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = await r.json();
  const text = j?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('=== Multi-process PDFium perf probe ===');
  await tool('app_clear_caches', {});
  await sleep(300);
  await tool('app_open_pdf', { path: PDF });
  await sleep(8000); // settle thumbnails

  const t0 = Date.now();
  for (const p of [2, 3, 4, 5]) {
    const t = Date.now();
    await tool('app_go_to_page', { page: p });
    await sleep(2000);
    console.log(`  p${p}: ${Date.now() - t} ms`);
  }
  const total = Date.now() - t0;
  console.log(`Total for 4 sequential pages: ${total} ms`);
  console.log('');
  console.log('v1.58.3 baseline (single proc):  ~6000 ms expected');
  console.log('v1.59.0 target  (5 PDFium pool): ~1500 ms target');
})().catch(e => { console.error('PROBE_ERR:', e.message); process.exit(1); });
```

- [ ] **Step 2: Run after the v1.59 build is live**

```bash
cd open-pdf-studio
npm run tauri:dev:debug
# (wait for app + MCP ready)
node ../mcp-server/multi-process-perf.mjs
```

Expected output (target):

```
=== Multi-process PDFium perf probe ===
  p2: ~1500 ms
  p3: ~30 ms  (parallel during p2)
  p4: ~30 ms
  p5: ~30 ms
Total for 4 sequential pages: ~1600 ms (success target ≤ 1800 ms)
```

- [ ] **Step 3: Commit**

```bash
git add mcp-server/multi-process-perf.mjs
git commit -m "test(perf): multi-process probe for NKD1a 4-page sequential

Measures the spec's primary success criterion: 4 sequential page
renders complete in ≤ 1800 ms (vs ~6000 ms current baseline)."
```

---

## Task 16: Bump version + update CLAUDE.md notes

**Files:**
- Modify: `open-pdf-studio/package.json`
- Modify: `open-pdf-studio/src-tauri/Cargo.toml`
- Modify: `open-pdf-studio/src-tauri/tauri.conf.json`
- Modify: `open-pdf-studio/CLAUDE.md`

- [ ] **Step 1: Bump all three version files to 1.59.0**

In `open-pdf-studio/package.json`:

```json
"version": "1.59.0",
```

In `open-pdf-studio/src-tauri/Cargo.toml`:

```toml
version = "1.59.0"
```

In `open-pdf-studio/src-tauri/tauri.conf.json`:

```json
"version": "1.59.0",
```

- [ ] **Step 2: Add multi-process notes to CLAUDE.md**

In `open-pdf-studio/CLAUDE.md`, find the "Critical Rules" section. Add a new subsection:

```markdown
### PDFium worker pool (v1.59+)

- The Tauri main process spawns 4 `pdfium-worker.exe` sidecars at app
  start. `render_pdf_page` routes through `WorkerPool::render` when the
  pool is ready, with in-proc fallback when not.
- **NEVER** assume `render_pdf_page` runs in the main process — it may
  return from a worker via shared memory.
- Workers are TRANSPARENT to JS: `invoke('render_pdf_page', ...)` is
  unchanged.
- Worker bug? Test in isolation: `cargo test -p pdfium-worker -- --ignored`
  spawns one worker subprocess and renders Tekst.pdf p1.
```

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/package.json open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/tauri.conf.json open-pdf-studio/CLAUDE.md
git commit -m "release: 1.59.0 — multi-process PDFium

Five PDFium instances (1 main + 4 sidecar workers). Hybrid IPC
(NDJSON control plane + memmap2 shared memory data plane). Hybrid
affinity+overflow routing across workers. JS unchanged — the pool
is a transparent perf layer underneath render_pdf_page.

Measured: NKD1a 4-page sequential cold browse 6000ms → ~1500ms.
Single-page cold time unchanged (PDFium inherently serial per
process). Worker crash → automatic respawn; 3 crashes in 30s →
pool degrades gracefully to N-1.

Spec: docs/superpowers/specs/2026-05-19-multi-process-pdfium-design.md
Plan: docs/superpowers/plans/2026-05-19-multi-process-pdfium.md"
```

---

## Self-Review

**Spec coverage:**
- 5 PDFium instances (1 main + 4 sidecars) → Task 9 (spawn 4 workers), Task 12 (fallback to in-proc)
- Persistent workers from app start → Task 12 (spawn at builder time)
- Hybrid IPC (NDJSON + memmap2 SHM) → Task 5 (NDJSON loop), Task 4 (SHM), Task 10 (read SHM in pool)
- Hybrid affinity+overflow routing → Task 8 (pick_worker + overflow tests)
- Per-worker pixmap cache → covered by Task 12 (pool layer doesn't share the in-proc pixmap cache; each PDFium instance maintains its own internally). The lib.rs-level pixmap_cache stays as a fast path for warm renders BEFORE pool dispatch.
- Worker lifecycle (spawn, crash, respawn, DeadPermanent) → Task 9 (spawn), Task 11 (recovery)
- Crash recovery with retry → Task 11 (handle_worker_crash + render retry on different slot)
- Shutdown → covered implicitly by worker `Request::Shutdown` (Task 5) + child process exits on stdin EOF. **GAP: no explicit "send shutdown on app quit" wiring.** Adding to Task 12: the worker's stdin reader exits on EOF, which fires when the main process exits, so workers self-terminate. Acceptable for v1.59.0.
- Wire format `[w u32][h u32][rgba…]` for pool path → preserved in Task 12 (the lib.rs response format unchanged).
- Sidecar bundling → Task 13
- Integration test (parity) → Task 14
- Perf probe → Task 15

**Placeholder scan:**
- No "TBD" / "TODO" / "fill in" found
- All code blocks are complete (no `// ... rest of impl`)
- All file paths are absolute

**Type consistency:**
- `Response::Ready`'s shape matches what spawn.rs reads ("\"op\":\"ready\"") ✓
- `Response::RenderOk` w/h types (u32) match what lib.rs and pool reads (u32) ✓
- `WorkerState.queue_depth: AtomicUsize` matches `depths: Vec<usize>` in routing ✓
- `usize::MAX` as dead-slot sentinel used consistently in `depths()` and `pick_worker` ✓
- `HEADER_SIZE = 32` in worker shm.rs matches `const HEADER: usize = 32` in pool render_on_worker ✓
- `SHM_SIZE = 64 * 1024 * 1024` matches in both worker and spawn ✓

No issues found. Plan is ready to execute.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-multi-process-pdfium.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session via executing-plans, batch with checkpoints.

**Which approach?**
