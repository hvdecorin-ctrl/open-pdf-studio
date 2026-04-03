# Vector Rendering Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 100fps pan/zoom voor technische PDF's door vectoren als draw commands naar de frontend te sturen in plaats van bitmaps te renderen.

**Architecture:** De bestaande `interpreter.rs` in open-pdf-render krijgt een tweede modus: in plaats van draw calls naar tiny-skia te sturen, serialiseert het de PDF operators als een compacte binaire command buffer. De frontend speelt deze commands af op Canvas2D. Zoom/pan = transform update + redraw (<5ms).

**Tech Stack:** Rust (lopdf, serde), JavaScript Canvas2D, Tauri IPC

---

## File Structure

```
open-pdf-render/src/
├── lib.rs                    # WIJZIG: add PageType enum, extract_draw_commands methode
├── parser.rs                 # WIJZIG: add analyze_page_type(), extract_draw_commands()
├── interpreter.rs            # WIJZIG: add extract_commands() modus (commands i.p.v. render)
├── draw_commands.rs          # NIEUW: DrawCommand enum + binaire serialisatie

open-pdf-studio/src-tauri/src/
└── lib.rs                    # WIJZIG: add analyze_page_type + extract_draw_commands commands

open-pdf-studio/js/pdf/
├── vector-renderer.js        # NIEUW: Canvas2D command player + transform management
└── renderer.js               # WIJZIG: mode switch (vector vs bitmap vs PDF.js)
```

---

### Task 1: DrawCommand enum + binaire serialisatie

**Files:**
- Create: `open-pdf-render/src/draw_commands.rs`
- Modify: `open-pdf-render/src/lib.rs`

- [ ] **Step 1: Maak draw_commands.rs**

```rust
// open-pdf-render/src/draw_commands.rs

/// Compact binary draw command format for frontend Canvas2D rendering.
/// Each command is a type byte followed by f32/u32 parameters in little-endian.

pub struct DrawCommandBuffer {
    data: Vec<u8>,
}

impl DrawCommandBuffer {
    pub fn new() -> Self {
        DrawCommandBuffer { data: Vec::with_capacity(64 * 1024) }
    }

    fn push_u8(&mut self, v: u8) { self.data.push(v); }
    fn push_f32(&mut self, v: f32) { self.data.extend_from_slice(&v.to_le_bytes()); }
    fn push_u32(&mut self, v: u32) { self.data.extend_from_slice(&v.to_le_bytes()); }

    pub fn move_to(&mut self, x: f32, y: f32) {
        self.push_u8(0); self.push_f32(x); self.push_f32(y);
    }
    pub fn line_to(&mut self, x: f32, y: f32) {
        self.push_u8(1); self.push_f32(x); self.push_f32(y);
    }
    pub fn cubic_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x3: f32, y3: f32) {
        self.push_u8(2);
        self.push_f32(x1); self.push_f32(y1);
        self.push_f32(x2); self.push_f32(y2);
        self.push_f32(x3); self.push_f32(y3);
    }
    pub fn rect(&mut self, x: f32, y: f32, w: f32, h: f32) {
        self.push_u8(3); self.push_f32(x); self.push_f32(y); self.push_f32(w); self.push_f32(h);
    }
    pub fn close_path(&mut self) { self.push_u8(4); }

    pub fn set_stroke(&mut self, r: u8, g: u8, b: u8, a: u8, width: f32) {
        self.push_u8(5);
        self.push_u32(u32::from_le_bytes([r, g, b, a]));
        self.push_f32(width);
    }
    pub fn set_fill(&mut self, r: u8, g: u8, b: u8, a: u8) {
        self.push_u8(6);
        self.push_u32(u32::from_le_bytes([r, g, b, a]));
    }
    pub fn stroke(&mut self) { self.push_u8(7); }
    pub fn fill(&mut self) { self.push_u8(8); }
    pub fn fill_even_odd(&mut self) { self.push_u8(9); }
    pub fn save_state(&mut self) { self.push_u8(10); }
    pub fn restore_state(&mut self) { self.push_u8(11); }

    pub fn transform(&mut self, a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) {
        self.push_u8(12);
        self.push_f32(a); self.push_f32(b); self.push_f32(c);
        self.push_f32(d); self.push_f32(e); self.push_f32(f);
    }

    pub fn set_line_cap(&mut self, cap: u8) { self.push_u8(13); self.push_u8(cap); }
    pub fn set_line_join(&mut self, join: u8) { self.push_u8(14); self.push_u8(join); }
    pub fn set_miter_limit(&mut self, limit: f32) { self.push_u8(15); self.push_f32(limit); }

    pub fn set_dash(&mut self, pattern: &[f32], phase: f32) {
        self.push_u8(16);
        self.push_u8(pattern.len() as u8);
        for &v in pattern { self.push_f32(v); }
        self.push_f32(phase);
    }

    pub fn begin_path(&mut self) { self.push_u8(17); }

    pub fn into_bytes(self) -> Vec<u8> { self.data }
    pub fn len(&self) -> usize { self.data.len() }
}
```

- [ ] **Step 2: Add module to lib.rs**

Add to `open-pdf-render/src/lib.rs`:
```rust
pub mod draw_commands;
```

And add to the public exports:
```rust
pub use draw_commands::DrawCommandBuffer;
```

Also add `PageType` enum:
```rust
#[derive(Debug, PartialEq)]
pub enum PageType {
    Vector,
    Tile,
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd open-pdf-render && cargo check`

- [ ] **Step 4: Commit**

```bash
git add open-pdf-render/src/draw_commands.rs open-pdf-render/src/lib.rs
git commit -m "feat: add DrawCommandBuffer for binary draw command serialization"
```

---

### Task 2: Command extraction mode in interpreter

**Files:**
- Modify: `open-pdf-render/src/interpreter.rs`

- [ ] **Step 1: Add extract_commands method**

Add a new public method to `Interpreter` that mirrors `execute()` but writes to a `DrawCommandBuffer` instead of a `SkiaRenderer`:

```rust
use crate::draw_commands::DrawCommandBuffer;

impl Interpreter {
    /// Extract draw commands from content stream without rendering.
    /// Returns a binary command buffer that the frontend can replay on Canvas2D.
    pub fn extract_commands(
        content_bytes: &[u8],
        state: &mut GraphicsStateStack,
    ) -> Result<DrawCommandBuffer, RenderError> {
        let content = Content::decode(content_bytes)
            .map_err(|e| RenderError::ParseError(format!("Content decode: {}", e)))?;

        let mut cmds = DrawCommandBuffer::new();
        let mut has_active_path = false;

        for op in &content.operations {
            match op.operator.as_str() {
                "q" => { state.save(); cmds.save_state(); }
                "Q" => { state.restore(); cmds.restore_state(); }
                "cm" => {
                    if op.operands.len() >= 6 {
                        let (a, b, c, d, e, f) = (
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                        state.concat_matrix(a, b, c, d, e, f);
                        cmds.transform(a, b, c, d, e, f);
                    }
                }
                "w" => {
                    if let Some(w) = op.operands.first() {
                        let width = Self::f(w);
                        state.current.line_width = width;
                        // Stroke color + width will be sent with next set_stroke
                    }
                }
                "J" => { if let Some(v) = op.operands.first() { let c = Self::i(v) as u8; state.current.line_cap = c; cmds.set_line_cap(c); } }
                "j" => { if let Some(v) = op.operands.first() { let j = Self::i(v) as u8; state.current.line_join = j; cmds.set_line_join(j); } }
                "M" => { if let Some(v) = op.operands.first() { let m = Self::f(v); state.current.miter_limit = m; cmds.set_miter_limit(m); } }
                "d" => {
                    if op.operands.len() >= 2 {
                        if let Object::Array(arr) = &op.operands[0] {
                            let pattern: Vec<f32> = arr.iter().map(|o| Self::f(o)).collect();
                            let phase = Self::f(&op.operands[1]);
                            state.current.dash_array = pattern.clone();
                            state.current.dash_phase = phase;
                            cmds.set_dash(&pattern, phase);
                        }
                    }
                }
                // Color
                "g" => { if let Some(v) = op.operands.first() { let (r,g,b) = color::gray_to_rgb(Self::f(v)); state.current.fill_color = (r,g,b,255); cmds.set_fill(r,g,b,255); } }
                "G" => { if let Some(v) = op.operands.first() { let (r,g,b) = color::gray_to_rgb(Self::f(v)); state.current.stroke_color = (r,g,b,255); cmds.set_stroke(r,g,b,255, state.current.line_width); } }
                "rg" => { if op.operands.len() >= 3 { let c = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); state.current.fill_color = c; cmds.set_fill(c.0,c.1,c.2,c.3); } }
                "RG" => { if op.operands.len() >= 3 { let c = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); state.current.stroke_color = c; cmds.set_stroke(c.0,c.1,c.2,c.3, state.current.line_width); } }
                "k" => { if op.operands.len() >= 4 { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.fill_color = (r,g,b,255); cmds.set_fill(r,g,b,255); } }
                "K" => { if op.operands.len() >= 4 { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.stroke_color = (r,g,b,255); cmds.set_stroke(r,g,b,255, state.current.line_width); } }
                "sc" | "scn" => {
                    match op.operands.len() {
                        3 => { let c = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); state.current.fill_color = c; cmds.set_fill(c.0,c.1,c.2,c.3); }
                        1 => { let (r,g,b) = color::gray_to_rgb(Self::f(&op.operands[0])); state.current.fill_color = (r,g,b,255); cmds.set_fill(r,g,b,255); }
                        _ => {}
                    }
                }
                "SC" | "SCN" => {
                    match op.operands.len() {
                        3 => { let c = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); state.current.stroke_color = c; cmds.set_stroke(c.0,c.1,c.2,c.3, state.current.line_width); }
                        1 => { let (r,g,b) = color::gray_to_rgb(Self::f(&op.operands[0])); state.current.stroke_color = (r,g,b,255); cmds.set_stroke(r,g,b,255, state.current.line_width); }
                        _ => {}
                    }
                }
                "cs" | "CS" => {}
                // Path
                "m" => { if op.operands.len() >= 2 { if !has_active_path { cmds.begin_path(); has_active_path = true; } cmds.move_to(Self::f(&op.operands[0]), Self::f(&op.operands[1])); } }
                "l" => { if op.operands.len() >= 2 { if !has_active_path { cmds.begin_path(); has_active_path = true; } cmds.line_to(Self::f(&op.operands[0]), Self::f(&op.operands[1])); } }
                "c" => { if op.operands.len() >= 6 { if !has_active_path { cmds.begin_path(); has_active_path = true; } cmds.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3]), Self::f(&op.operands[4]), Self::f(&op.operands[5])); } }
                "v" => { if op.operands.len() >= 4 { if !has_active_path { cmds.begin_path(); has_active_path = true; } cmds.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "y" => { if op.operands.len() >= 4 { if !has_active_path { cmds.begin_path(); has_active_path = true; } cmds.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "re" => { if op.operands.len() >= 4 { if !has_active_path { cmds.begin_path(); has_active_path = true; } cmds.rect(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "h" => { cmds.close_path(); }
                // Paint
                "S" => { cmds.set_stroke(state.current.stroke_color.0, state.current.stroke_color.1, state.current.stroke_color.2, state.current.stroke_color.3, state.current.line_width); cmds.stroke(); has_active_path = false; }
                "s" => { cmds.close_path(); cmds.set_stroke(state.current.stroke_color.0, state.current.stroke_color.1, state.current.stroke_color.2, state.current.stroke_color.3, state.current.line_width); cmds.stroke(); has_active_path = false; }
                "f" | "F" => { cmds.set_fill(state.current.fill_color.0, state.current.fill_color.1, state.current.fill_color.2, state.current.fill_color.3); cmds.fill(); has_active_path = false; }
                "f*" => { cmds.set_fill(state.current.fill_color.0, state.current.fill_color.1, state.current.fill_color.2, state.current.fill_color.3); cmds.fill_even_odd(); has_active_path = false; }
                "B" => { cmds.set_fill(state.current.fill_color.0, state.current.fill_color.1, state.current.fill_color.2, state.current.fill_color.3); cmds.fill(); cmds.set_stroke(state.current.stroke_color.0, state.current.stroke_color.1, state.current.stroke_color.2, state.current.stroke_color.3, state.current.line_width); cmds.stroke(); has_active_path = false; }
                "n" => { has_active_path = false; }
                // Skip text, images, clipping for now
                "BT"|"ET"|"Tf"|"Td"|"TD"|"Tm"|"Tj"|"TJ"|"T*"|"'"|"\""|"Tc"|"Tw"|"Tz"|"TL"|"Ts"|"Tr" => {}
                "Do" => {}
                "W"|"W*" => {}
                "gs"|"ri"|"i" => {}
                _ => {}
            }
        }
        Ok(cmds)
    }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd open-pdf-render && cargo check`

- [ ] **Step 3: Commit**

```bash
git add open-pdf-render/src/interpreter.rs
git commit -m "feat: add extract_commands mode to interpreter"
```

---

### Task 3: Page type analysis + extract API on DocumentHandle

**Files:**
- Modify: `open-pdf-render/src/parser.rs`
- Modify: `open-pdf-render/src/lib.rs`

- [ ] **Step 1: Add methods to DocumentHandle**

In `open-pdf-render/src/parser.rs`, add:

```rust
use crate::{PageType, DrawCommandBuffer};

impl DocumentHandle {
    /// Analyze whether a page is pure vector or contains raster content
    pub fn analyze_page_type(&self, page: usize) -> Result<PageType, RenderError> {
        let page_id = self.get_page_id(page)?;
        let content_bytes = self.get_content_stream(page_id)?;
        let content = lopdf::content::Content::decode(&content_bytes)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;

        for op in &content.operations {
            match op.operator.as_str() {
                "Do" | "sh" => return Ok(PageType::Tile),
                _ => {}
            }
        }
        Ok(PageType::Vector)
    }

    /// Extract draw commands without rendering to bitmap
    pub fn extract_draw_commands(&self, page: usize) -> Result<DrawCommandBuffer, RenderError> {
        let page_id = self.get_page_id(page)?;
        let (w_pt, h_pt) = self.extract_media_box(page_id)?;
        let content_bytes = self.get_content_stream(page_id)?;

        let mut state = crate::graphics_state::GraphicsStateStack::new();
        // Set initial PDF→screen transform (Y-flip)
        let mut cmds = crate::interpreter::Interpreter::extract_commands(&content_bytes, &mut state)?;

        // Prepend page dimensions as first 8 bytes (f32 LE width + f32 LE height)
        let mut result = Vec::with_capacity(8 + cmds.len());
        result.extend_from_slice(&w_pt.to_le_bytes());
        result.extend_from_slice(&h_pt.to_le_bytes());
        result.extend(cmds.into_bytes());

        Ok(DrawCommandBuffer::from_vec(result))
    }
}
```

Add `from_vec` to `DrawCommandBuffer`:
```rust
pub fn from_vec(data: Vec<u8>) -> Self {
    DrawCommandBuffer { data }
}
```

- [ ] **Step 2: Export PageType from lib.rs**

Already done in Task 1.

- [ ] **Step 3: Test with real PDF**

Add to `open-pdf-render/tests/test_real_pdf.rs`:
```rust
#[test]
fn test_analyze_page_type() {
    let path = r"C:\3BM\50_projecten\...bouwtekening.pdf";
    let bytes = fs::read(path).unwrap();
    let renderer = PdfRenderer::new();
    let doc = renderer.load_document(&bytes).unwrap();
    let page_type = doc.analyze_page_type(0).unwrap();
    // Bouwtekeningen zijn vector
    println!("Page type: {:?}", page_type);
}

#[test]
fn test_extract_draw_commands() {
    let path = r"C:\3BM\50_projecten\...bouwtekening.pdf";
    let bytes = fs::read(path).unwrap();
    let renderer = PdfRenderer::new();
    let doc = renderer.load_document(&bytes).unwrap();
    let cmds = doc.extract_draw_commands(0).unwrap();
    let data = cmds.into_bytes();
    println!("Draw commands: {} bytes ({} KB)", data.len(), data.len() / 1024);
    assert!(data.len() > 8, "Should have more than just the header");
}
```

Run: `cd open-pdf-render && cargo test test_extract -- --nocapture`

- [ ] **Step 4: Commit**

```bash
git add open-pdf-render/
git commit -m "feat: add analyze_page_type and extract_draw_commands to DocumentHandle"
```

---

### Task 4: Tauri commands for vector mode

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/lib.rs`

- [ ] **Step 1: Add two new Tauri commands**

```rust
#[tauri::command]
fn analyze_page_type(path: String, page_index: u32, cache: tauri::State<PdfBytesCache>) -> Result<String, String> {
    let bytes = {
        let mut c = cache.0.lock().map_err(|e| format!("{}", e))?;
        if let Some(b) = c.get(&path) { b.clone() }
        else { let b = fs::read(&path).map_err(|e| format!("{}", e))?; c.insert(path.clone(), b.clone()); b }
    };
    let renderer = PdfRenderer::new();
    let doc = renderer.load_document(&bytes).map_err(|e| format!("{}", e))?;
    match doc.analyze_page_type(page_index as usize).map_err(|e| format!("{}", e))? {
        open_pdf_render::PageType::Vector => Ok("vector".into()),
        open_pdf_render::PageType::Tile => Ok("tile".into()),
    }
}

#[tauri::command]
fn extract_draw_commands(path: String, page_index: u32, cache: tauri::State<PdfBytesCache>) -> Result<Vec<u8>, String> {
    let bytes = {
        let mut c = cache.0.lock().map_err(|e| format!("{}", e))?;
        if let Some(b) = c.get(&path) { b.clone() }
        else { let b = fs::read(&path).map_err(|e| format!("{}", e))?; c.insert(path.clone(), b.clone()); b }
    };
    let renderer = PdfRenderer::new();
    let doc = renderer.load_document(&bytes).map_err(|e| format!("{}", e))?;
    let cmds = doc.extract_draw_commands(page_index as usize).map_err(|e| format!("{}", e))?;
    Ok(cmds.into_bytes())
}
```

Register both in `invoke_handler`:
```
analyze_page_type,
extract_draw_commands,
```

- [ ] **Step 2: Verify compilation**

Run: `cd open-pdf-studio/src-tauri && cargo check`

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat: add analyze_page_type and extract_draw_commands Tauri commands"
```

---

### Task 5: Frontend vector renderer

**Files:**
- Create: `open-pdf-studio/js/pdf/vector-renderer.js`

- [ ] **Step 1: Create the Canvas2D command player**

```javascript
// js/pdf/vector-renderer.js
// Plays back binary draw commands from Rust on Canvas2D.
// Commands are extracted once per page, then replayed on every pan/zoom (<5ms).

// Command type constants (must match draw_commands.rs)
const CMD_MOVE_TO = 0, CMD_LINE_TO = 1, CMD_CUBIC_TO = 2, CMD_RECT = 3,
      CMD_CLOSE = 4, CMD_SET_STROKE = 5, CMD_SET_FILL = 6, CMD_STROKE = 7,
      CMD_FILL = 8, CMD_FILL_EO = 9, CMD_SAVE = 10, CMD_RESTORE = 11,
      CMD_TRANSFORM = 12, CMD_LINE_CAP = 13, CMD_LINE_JOIN = 14,
      CMD_MITER_LIMIT = 15, CMD_DASH = 16, CMD_BEGIN_PATH = 17;

// Cache for parsed commands per page
const _commandCache = new Map(); // "filePath:pageNum" → { pageW, pageH, data: DataView }

export function clearVectorCache() {
  _commandCache.clear();
}

export function cacheCommands(filePath, pageNum, rawBytes) {
  // rawBytes: Uint8Array with 8-byte header (f32 pageW + f32 pageH) + command data
  const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.length);
  const pageW = view.getFloat32(0, true);
  const pageH = view.getFloat32(4, true);
  const key = `${filePath}:${pageNum}`;
  _commandCache.set(key, { pageW, pageH, data: rawBytes, offset: 8 });
}

export function hasCachedCommands(filePath, pageNum) {
  return _commandCache.has(`${filePath}:${pageNum}`);
}

export function getCachedPageDimensions(filePath, pageNum) {
  const entry = _commandCache.get(`${filePath}:${pageNum}`);
  return entry ? { w: entry.pageW, h: entry.pageH } : null;
}

/**
 * Render vector commands onto a Canvas2D context.
 * The transform parameter controls zoom/pan — update it and call again for instant zoom.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} filePath
 * @param {number} pageNum
 * @param {{ a: number, b: number, c: number, d: number, e: number, f: number }} transform
 */
export function renderVectorPage(ctx, filePath, pageNum, transform) {
  const entry = _commandCache.get(`${filePath}:${pageNum}`);
  if (!entry) return false;

  const { data, offset: startOffset } = entry;
  const view = new DataView(data.buffer, data.byteOffset, data.length);

  ctx.save();
  // Apply zoom/pan transform
  ctx.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  // PDF Y-flip: origin at bottom-left, Y up → canvas top-left, Y down
  ctx.transform(1, 0, 0, -1, 0, entry.pageH);

  ctx.beginPath();
  let pos = startOffset;

  while (pos < data.length) {
    const cmd = data[pos++];
    switch (cmd) {
      case CMD_MOVE_TO:
        ctx.moveTo(view.getFloat32(pos, true), view.getFloat32(pos + 4, true));
        pos += 8; break;
      case CMD_LINE_TO:
        ctx.lineTo(view.getFloat32(pos, true), view.getFloat32(pos + 4, true));
        pos += 8; break;
      case CMD_CUBIC_TO:
        ctx.bezierCurveTo(
          view.getFloat32(pos, true), view.getFloat32(pos + 4, true),
          view.getFloat32(pos + 8, true), view.getFloat32(pos + 12, true),
          view.getFloat32(pos + 16, true), view.getFloat32(pos + 20, true)
        );
        pos += 24; break;
      case CMD_RECT:
        ctx.rect(view.getFloat32(pos, true), view.getFloat32(pos + 4, true),
                 view.getFloat32(pos + 8, true), view.getFloat32(pos + 12, true));
        pos += 16; break;
      case CMD_CLOSE:
        ctx.closePath(); break;
      case CMD_SET_STROKE: {
        const rgba = view.getUint32(pos, true);
        const r = rgba & 0xFF, g = (rgba >> 8) & 0xFF, b = (rgba >> 16) & 0xFF, a = (rgba >> 24) & 0xFF;
        ctx.strokeStyle = `rgba(${r},${g},${b},${a / 255})`;
        ctx.lineWidth = view.getFloat32(pos + 4, true);
        pos += 8; break;
      }
      case CMD_SET_FILL: {
        const rgba = view.getUint32(pos, true);
        const r = rgba & 0xFF, g = (rgba >> 8) & 0xFF, b = (rgba >> 16) & 0xFF, a = (rgba >> 24) & 0xFF;
        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        pos += 4; break;
      }
      case CMD_STROKE:
        ctx.stroke(); ctx.beginPath(); break;
      case CMD_FILL:
        ctx.fill(); ctx.beginPath(); break;
      case CMD_FILL_EO:
        ctx.fill('evenodd'); ctx.beginPath(); break;
      case CMD_SAVE:
        ctx.save(); break;
      case CMD_RESTORE:
        ctx.restore(); break;
      case CMD_TRANSFORM:
        ctx.transform(
          view.getFloat32(pos, true), view.getFloat32(pos + 4, true),
          view.getFloat32(pos + 8, true), view.getFloat32(pos + 12, true),
          view.getFloat32(pos + 16, true), view.getFloat32(pos + 20, true)
        );
        pos += 24; break;
      case CMD_LINE_CAP:
        ctx.lineCap = ['butt', 'round', 'square'][data[pos]] || 'butt';
        pos += 1; break;
      case CMD_LINE_JOIN:
        ctx.lineJoin = ['miter', 'round', 'bevel'][data[pos]] || 'miter';
        pos += 1; break;
      case CMD_MITER_LIMIT:
        ctx.miterLimit = view.getFloat32(pos, true);
        pos += 4; break;
      case CMD_DASH: {
        const count = data[pos++];
        const pattern = [];
        for (let i = 0; i < count; i++) {
          pattern.push(view.getFloat32(pos, true));
          pos += 4;
        }
        const phase = view.getFloat32(pos, true); pos += 4;
        ctx.setLineDash(pattern);
        ctx.lineDashOffset = phase;
        break;
      }
      case CMD_BEGIN_PATH:
        ctx.beginPath(); break;
      default:
        console.warn(`[vector-renderer] Unknown command: ${cmd} at pos ${pos - 1}`);
        ctx.restore();
        return false; // Abort on unknown command
    }
  }

  ctx.restore();
  return true;
}
```

- [ ] **Step 2: Commit**

```bash
git add open-pdf-studio/js/pdf/vector-renderer.js
git commit -m "feat: add Canvas2D vector command player"
```

---

### Task 6: Integrate vector mode in renderer.js

**Files:**
- Modify: `open-pdf-studio/js/pdf/renderer.js`

- [ ] **Step 1: Add vector mode to renderPage**

In the `renderPage` function, before the current Rust bitmap path, add:

```javascript
// First check: is this a vector page? If so, use instant vector rendering
if (isTauri() && doc.filePath) {
  const { hasCachedCommands, renderVectorPage, cacheCommands, clearVectorCache } = await import('./vector-renderer.js');

  if (!hasCachedCommands(doc.filePath, pageNum)) {
    // First time: ask Rust for page type
    try {
      const pageType = await invoke('analyze_page_type', {
        path: doc.filePath, pageIndex: pageNum - 1
      });

      if (pageType === 'vector') {
        // Extract commands (one-time, ~50ms)
        const cmdBytes = await invoke('extract_draw_commands', {
          path: doc.filePath, pageIndex: pageNum - 1
        });
        const bytes = cmdBytes instanceof Uint8Array ? cmdBytes : new Uint8Array(cmdBytes);
        cacheCommands(doc.filePath, pageNum, bytes);
      }
    } catch (e) {
      console.warn('[render] Vector analysis failed:', e);
    }
  }

  if (hasCachedCommands(doc.filePath, pageNum)) {
    // VECTOR MODE: instant render via Canvas2D replay
    const t0 = performance.now();
    const dpr = getCanvasDPR();
    const dims = (await import('./vector-renderer.js')).getCachedPageDimensions(doc.filePath, pageNum);
    const canvasW = Math.ceil(dims.w * scale * dpr);
    const canvasH = Math.ceil(dims.h * scale * dpr);

    pdfCanvas.width = canvasW;
    pdfCanvas.height = canvasH;
    pdfCanvas.style.width = Math.floor(dims.w * scale) + 'px';
    pdfCanvas.style.height = Math.floor(dims.h * scale) + 'px';

    const ctx = pdfCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    const transform = { a: scale * dpr, b: 0, c: 0, d: scale * dpr, e: 0, f: 0 };
    renderVectorPage(ctx, doc.filePath, pageNum, transform);

    const elapsed = Math.round(performance.now() - t0);
    state.renderEngine = 'Rust Vector';
    state.renderTiming = `${elapsed}ms`;
    console.log(`[render] ✅ Vector render: ${canvasW}x${canvasH}, ${elapsed}ms`);

    // Skip bitmap rendering — go straight to text/annotation layers
    // (continue with the rest of renderPage after the if/else blocks)
    goto_layers = true;
  }
}
```

Note: since JavaScript doesn't have `goto`, implement this as an early return pattern or a boolean flag that skips the bitmap render path.

- [ ] **Step 2: Test via CDP**

Start app with CDP, open a bouwtekening, check console for `[render] ✅ Vector render`.

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer.js
git commit -m "feat: integrate vector rendering mode with auto-detection"
```

---

### Task 7: Instant zoom/pan for vector mode

**Files:**
- Modify: `open-pdf-studio/js/ui/setup/navigation-events.js`

- [ ] **Step 1: Update zoom handler for vector mode**

In the wheel zoom handler, when the page is in vector mode, skip the debounced re-render entirely. Instead, immediately redraw with the new transform:

```javascript
// After CSS-scale preview, check if vector mode
if (!isContinuous) {
  const { hasCachedCommands, renderVectorPage, getCachedPageDimensions } = await import('../../pdf/vector-renderer.js');
  if (hasCachedCommands(doc.filePath, doc.currentPage)) {
    // VECTOR MODE: instant re-render, no debounce needed
    if (_zoomRenderTimer) clearTimeout(_zoomRenderTimer);
    _zoomRenderTimer = null;
    _zoomBaseScale = null;

    // Clear CSS overrides
    document.querySelectorAll(canvasSelector).forEach(c => {
      c.style.width = '';
      c.style.height = '';
    });

    // Instant vector redraw
    requestAnimationFrame(() => {
      const canvas = document.getElementById('pdf-canvas');
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const dims = getCachedPageDimensions(doc.filePath, doc.currentPage);
      if (!dims) return;

      canvas.width = Math.ceil(dims.w * doc.scale * dpr);
      canvas.height = Math.ceil(dims.h * doc.scale * dpr);
      canvas.style.width = Math.floor(dims.w * doc.scale) + 'px';
      canvas.style.height = Math.floor(dims.h * doc.scale) + 'px';

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const transform = { a: doc.scale * dpr, b: 0, c: 0, d: doc.scale * dpr, e: 0, f: 0 };
      renderVectorPage(ctx, doc.filePath, doc.currentPage, transform);

      // Redraw annotations too
      import('../../annotations/rendering.js').then(m => m.redrawAnnotations());
    });
    return; // Skip debounce
  }
}
```

- [ ] **Step 2: Test zoom speed via CDP**

Measure time between zoom event and render completion. Target: <16ms (60fps).

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/js/ui/setup/navigation-events.js
git commit -m "feat: instant vector zoom without debounce"
```
