use lopdf::content::Content;
use lopdf::{Document, Dictionary, Object};
use crate::graphics_state::GraphicsStateStack;
use crate::renderer::SkiaRenderer;
use crate::draw_commands::DrawCommandBuffer;
use crate::fonts::FontRegistry;
use crate::color;
use crate::RenderError;

/// A text span with position, size, and Unicode text content.
/// Used to build a synthetic text selection layer in the frontend.
#[derive(Clone, Debug)]
pub struct TextSpan {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub font_size: f32,
    pub text: String,
}

impl TextSpan {
    pub fn to_json(&self) -> String {
        format!(
            r#"{{"x":{},"y":{},"width":{},"height":{},"fontSize":{},"text":"{}"}}"#,
            self.x, self.y, self.width, self.height, self.font_size,
            self.text.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r")
        )
    }
}

/// PDF Text State — follows PDF spec §9.3 and §9.4 exactly.
///
/// Two matrices track text position:
/// - `tm`:  Text Matrix — current glyph rendering position
/// - `tlm`: Text Line Matrix — start of current line (set by Td/TD/Tm/T*)
///
/// Character advances update `tm` via matrix pre-multiplication:
///   tm_new = [1 0 0 1 tx ty] × tm_old
///
/// Line moves (Td/TD/T*) update `tlm` then copy to `tm`.
struct TextState {
    font_size: f32,            // Tfs — set by Tf operator
    horizontal_scaling: f32,   // Th — set by Tz operator (1.0 = 100%)
    char_spacing: f32,         // Tc — set by Tc operator
    word_spacing: f32,         // Tw — set by Tw operator
    leading: f32,              // TL — set by TL operator
    rise: f32,                 // Trise — set by Ts operator
    tm: [f32; 6],             // Text matrix [a b c d e f]
    tlm: [f32; 6],            // Text line matrix
    in_text: bool,
    current_font_name: String,
}

impl TextState {
    fn new() -> Self {
        TextState {
            font_size: 12.0,
            horizontal_scaling: 1.0,
            char_spacing: 0.0,
            word_spacing: 0.0,
            leading: 0.0,
            rise: 0.0,
            tm: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            tlm: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            in_text: false,
            current_font_name: String::new(),
        }
    }

    /// BT operator: reset text matrices to identity
    fn begin_text(&mut self) {
        self.tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        self.tlm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        self.in_text = true;
    }

    /// Td operator: move to start of next line.
    /// PDF spec: Tlm = [1 0 0 1 tx ty] × Tlm; Tm = Tlm
    fn translate_line(&mut self, tx: f32, ty: f32) {
        let new_e = tx * self.tlm[0] + ty * self.tlm[2] + self.tlm[4];
        let new_f = tx * self.tlm[1] + ty * self.tlm[3] + self.tlm[5];
        self.tlm[4] = new_e;
        self.tlm[5] = new_f;
        self.tm = self.tlm;
    }

    /// Tm operator: set text matrix and line matrix directly
    fn set_text_matrix(&mut self, a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) {
        self.tm = [a, b, c, d, e, f];
        self.tlm = self.tm;
    }

    /// Advance for TJ kerning: adjust = -(kern/1000) × Tfs × Th
    fn apply_tj_kern(&mut self, kern: f32) {
        let tx = -(kern / 1000.0) * self.font_size * self.horizontal_scaling;
        self.tm[4] += tx * self.tm[0];
        self.tm[5] += tx * self.tm[1];
    }

    /// Get the effective text position including rise offset.
    /// Trm position = (Trise × Tm[2] + Tm[4], Trise × Tm[3] + Tm[5])
    fn render_x(&self) -> f32 {
        self.rise * self.tm[2] + self.tm[4]
    }

    fn render_y(&self) -> f32 {
        self.rise * self.tm[3] + self.tm[5]
    }
}

pub struct Interpreter;

impl Interpreter {
    /// Execute content stream, rendering all content including full-resolution images.
    pub fn execute(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut FontRegistry,
    ) -> Result<(), RenderError> {
        Self::execute_internal(content_bytes, renderer, state, doc, resources, font_registry, 0)
    }

    /// Execute content stream with a pixel budget for images. Images larger
    /// than `max_pixels` are downsampled after decode. Use for thumbnails
    /// to keep rendering fast without skipping images entirely.
    pub fn execute_with_image_limit(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut FontRegistry,
        max_pixels: u32,
    ) -> Result<(), RenderError> {
        Self::execute_internal(content_bytes, renderer, state, doc, resources, font_registry, max_pixels)
    }

    fn execute_internal(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut FontRegistry,
        max_image_pixels: u32,
    ) -> Result<(), RenderError> {
        let content = Content::decode(content_bytes)
            .map_err(|e| RenderError::ParseError(format!("Content decode: {}", e)))?;

        let mut has_active_path = false;
        let mut text_state = TextState::new();
        // PDF clipping is two-step: `W` (or `W*`) marks the current path
        // as a future clip, then the next path-painting/no-op operator
        // (S/s/f/f*/B/B*/b/b*/n) actually consumes the path. We track the
        // pending state with this Option<even_odd_flag>; the snapshot is
        // applied to the GraphicsState clip mask just before the paint
        // operator takes the path builder. The path itself is still
        // consumed by the paint op via path_builder.take().
        let mut pending_clip: Option<bool> = None;

        for op in &content.operations {
            // If a W/W* was just seen, the next paint op (or n) consumes
            // the path AND uses it as the clip — snapshot it now before
            // the paint op takes the builder.
            if pending_clip.is_some() {
                let is_paint_or_noop = matches!(
                    op.operator.as_str(),
                    "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n"
                );
                if is_paint_or_noop {
                    if let Some(path) = renderer.snapshot_path() {
                        let even_odd = pending_clip.unwrap();
                        renderer.apply_clip(&mut state.current, &path, even_odd);
                    }
                    pending_clip = None;
                }
            }
            match op.operator.as_str() {
                // Graphics state
                "q" => state.save(),
                "Q" => state.restore(),
                "cm" => {
                    if op.operands.len() >= 6 {
                        state.concat_matrix(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "w" => { if let Some(w) = op.operands.first() { state.current.line_width = Self::f(w); } }
                "J" => { if let Some(v) = op.operands.first() { state.current.line_cap = Self::i(v) as u8; } }
                "j" => { if let Some(v) = op.operands.first() { state.current.line_join = Self::i(v) as u8; } }
                "M" => { if let Some(v) = op.operands.first() { state.current.miter_limit = Self::f(v); } }
                "d" => {
                    if op.operands.len() >= 2 {
                        if let Object::Array(arr) = &op.operands[0] {
                            state.current.dash_array = arr.iter().map(|o| Self::f(o)).collect();
                        }
                        state.current.dash_phase = Self::f(&op.operands[1]);
                    }
                }
                // Color - grayscale
                "g" => { if let Some(v) = op.operands.first() { let (r,g,b) = color::gray_to_rgb(Self::f(v)); state.current.fill_color = (r,g,b,255); } }
                "G" => { if let Some(v) = op.operands.first() { let (r,g,b) = color::gray_to_rgb(Self::f(v)); state.current.stroke_color = (r,g,b,255); } }
                // Color - RGB
                "rg" => { if op.operands.len() >= 3 { state.current.fill_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); } }
                "RG" => { if op.operands.len() >= 3 { state.current.stroke_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); } }
                // Color - CMYK
                "k" => { if op.operands.len() >= 4 { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.fill_color = (r,g,b,255); } }
                "K" => { if op.operands.len() >= 4 { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.stroke_color = (r,g,b,255); } }
                // Color - colorspace operators (simplified)
                "sc" | "scn" => {
                    match op.operands.len() {
                        3 => { state.current.fill_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); }
                        1 => { let (r,g,b) = color::gray_to_rgb(Self::f(&op.operands[0])); state.current.fill_color = (r,g,b,255); }
                        4 => { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.fill_color = (r,g,b,255); }
                        _ => {}
                    }
                }
                "SC" | "SCN" => {
                    match op.operands.len() {
                        3 => { state.current.stroke_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); }
                        1 => { let (r,g,b) = color::gray_to_rgb(Self::f(&op.operands[0])); state.current.stroke_color = (r,g,b,255); }
                        4 => { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.stroke_color = (r,g,b,255); }
                        _ => {}
                    }
                }
                "cs" | "CS" => {}
                // Path construction
                "m" => { if op.operands.len() >= 2 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.move_to(Self::f(&op.operands[0]), Self::f(&op.operands[1])); } }
                "l" => { if op.operands.len() >= 2 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.line_to(Self::f(&op.operands[0]), Self::f(&op.operands[1])); } }
                "c" => { if op.operands.len() >= 6 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3]), Self::f(&op.operands[4]), Self::f(&op.operands[5])); } }
                "v" => { if op.operands.len() >= 4 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "y" => { if op.operands.len() >= 4 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "re" => { if op.operands.len() >= 4 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.rect(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "h" => { renderer.close_path(); }
                // Path painting
                "S" => { renderer.stroke(&state.current); has_active_path = false; }
                "s" => { renderer.close_path(); renderer.stroke(&state.current); has_active_path = false; }
                "f" | "F" => { renderer.fill(&state.current, false); has_active_path = false; }
                "f*" => { renderer.fill(&state.current, true); has_active_path = false; }
                "B" => { renderer.fill_and_stroke(&state.current, false); has_active_path = false; }
                "B*" => { renderer.fill_and_stroke(&state.current, true); has_active_path = false; }
                "b" => { renderer.close_path(); renderer.fill_and_stroke(&state.current, false); has_active_path = false; }
                "b*" => { renderer.close_path(); renderer.fill_and_stroke(&state.current, true); has_active_path = false; }
                "n" => { has_active_path = false; }
                // Clipping — record the pending clip; the path is captured
                // and applied to gs.clip_path immediately before the next
                // paint/no-op operator consumes the path builder.
                "W" => { pending_clip = Some(false); }
                "W*" => { pending_clip = Some(true); }
                // Text operators
                "BT" => { text_state.begin_text(); }
                "ET" => { text_state.in_text = false; }
                "Tf" => {
                    if op.operands.len() >= 2 {
                        if let Object::Name(ref name_bytes) = op.operands[0] {
                            text_state.current_font_name = String::from_utf8_lossy(name_bytes).to_string();
                        }
                        text_state.font_size = Self::f(&op.operands[1]);
                    }
                }
                "Tc" => { if let Some(v) = op.operands.first() { text_state.char_spacing = Self::f(v); } }
                "Tw" => { if let Some(v) = op.operands.first() { text_state.word_spacing = Self::f(v); } }
                "Tz" => { if let Some(v) = op.operands.first() { text_state.horizontal_scaling = Self::f(v) / 100.0; } }
                "TL" => { if let Some(v) = op.operands.first() { text_state.leading = Self::f(v); } }
                "Ts" => { if let Some(v) = op.operands.first() { text_state.rise = Self::f(v); } }
                "Tr" => {} // text rendering mode — fill-only path used for now
                "Td" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.translate_line(tx, ty);
                    }
                }
                "TD" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.leading = -ty;
                        text_state.translate_line(tx, ty);
                    }
                }
                "Tm" => {
                    if op.operands.len() >= 6 {
                        text_state.set_text_matrix(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "T*" => { text_state.translate_line(0.0, -text_state.leading); }
                "Tj" => {
                    Self::execute_show_string(
                        &op.operands, &mut text_state, font_registry,
                        renderer, state, doc, resources,
                    );
                }
                "TJ" => {
                    Self::execute_show_array(
                        &op.operands, &mut text_state, font_registry,
                        renderer, state, doc, resources,
                    );
                }
                "'" => {
                    text_state.translate_line(0.0, -text_state.leading);
                    Self::execute_show_string(
                        &op.operands, &mut text_state, font_registry,
                        renderer, state, doc, resources,
                    );
                }
                "\"" => {
                    if op.operands.len() >= 3 {
                        text_state.word_spacing = Self::f(&op.operands[0]);
                        text_state.char_spacing = Self::f(&op.operands[1]);
                        text_state.translate_line(0.0, -text_state.leading);
                        let tail = &op.operands[2..];
                        Self::execute_show_string(
                            tail, &mut text_state, font_registry,
                            renderer, state, doc, resources,
                        );
                    }
                }
                "Do" => {
                    Self::handle_do_execute(&op.operands, renderer, state, doc, resources, font_registry, max_image_pixels);
                }
                "gs" => {
                    Self::apply_ext_gstate(&op.operands, state, doc, resources);
                }
                "ri" | "i" => {}
                _ => {}
            }
        }
        Ok(())
    }

    fn handle_do_execute(
        operands: &[Object],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut FontRegistry,
        max_image_pixels: u32,
    ) {
        let name = match operands.first() {
            Some(Object::Name(n)) => n,
            _ => return,
        };
        let xobj_dict = match resources.get(b"XObject").and_then(|o| Self::resolve_dict(o, doc)) {
            Ok(d) => d,
            _ => return,
        };
        let obj_ref = match xobj_dict.get(name.as_slice()) {
            Ok(o) => o,
            _ => return,
        };
        let resolved_id = match obj_ref {
            Object::Reference(id) => *id,
            _ => return,
        };
        let obj = match doc.get_object(resolved_id) {
            Ok(o) => o,
            _ => return,
        };
        let stream = match obj {
            Object::Stream(ref s) => s,
            _ => return,
        };
        let subtype = stream.dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok());
        if subtype == Some(b"Image" as &[u8]) {
            Self::handle_image_execute(stream, renderer, state, doc, max_image_pixels);
            return;
        }
        if subtype != Some(b"Form" as &[u8]) {
            return;
        }
        state.save();
        if let Ok(matrix) = stream.dict.get(b"Matrix") {
            if let Ok(arr) = matrix.as_array() {
                if arr.len() >= 6 {
                    state.concat_matrix(
                        Self::f(&arr[0]), Self::f(&arr[1]),
                        Self::f(&arr[2]), Self::f(&arr[3]),
                        Self::f(&arr[4]), Self::f(&arr[5]),
                    );
                }
            }
        }
        // Transparency-group Form XObjects (PDF 1.4+) should be rendered
        // into an isolated buffer at full alpha and then composited onto
        // the parent at the parent's current /ca. We don't allocate a
        // separate pixmap; instead we fold the parent's accumulated alpha
        // into a multiplier (group_*_alpha) and reset the in-group alpha
        // to 1.0 — at draw time we multiply the two. This is the right
        // answer for single-level groups and a close approximation for
        // nested ones.
        let is_transparency_group = stream.dict.get(b"Group")
            .ok()
            .and_then(|g| Self::resolve_dict(g, doc).ok())
            .and_then(|d| d.get(b"S").ok())
            .and_then(|s| s.as_name().ok())
            == Some(b"Transparency" as &[u8]);
        if is_transparency_group {
            let cur = &mut state.current;
            cur.group_fill_alpha = (cur.group_fill_alpha * cur.fill_alpha).clamp(0.0, 1.0);
            cur.group_stroke_alpha = (cur.group_stroke_alpha * cur.stroke_alpha).clamp(0.0, 1.0);
            cur.fill_alpha = 1.0;
            cur.stroke_alpha = 1.0;
        }
        let form_resources = Self::extract_form_resources(&stream.dict, doc);
        let res = form_resources.as_ref().unwrap_or(resources);
        if let Ok(content_bytes) = stream.decompressed_content() {
            let _ = Self::execute_internal(&content_bytes, renderer, state, doc, res, font_registry, max_image_pixels);
        }
        state.restore();
    }

    /// Server-side text-show for the Tj operator. Resolves the current font
    /// through the FontRegistry, then dispatches to the simple- or
    /// CID-text path in `text_renderer` to paint glyphs straight into the
    /// SkiaRenderer (text rendering mode is treated as fill-only for now).
    fn execute_show_string(
        operands: &[Object],
        text_state: &mut TextState,
        font_registry: &mut FontRegistry,
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
    ) {
        let bytes = match operands.first() {
            Some(Object::String(b, _)) if !b.is_empty() => b.clone(),
            _ => return,
        };
        let font_entry = match font_registry.get_font(&text_state.current_font_name, doc, resources) {
            Some(fe) => fe,
            None => return,
        };
        if font_entry.parsed.is_none() { return; }
        let fill = state.current.fill_color;
        if font_entry.is_cid {
            crate::text_renderer::render_cid_text_glyphs_skia(
                &bytes, &*font_entry, text_state.font_size,
                text_state.horizontal_scaling, text_state.char_spacing,
                text_state.word_spacing, text_state.rise,
                &mut text_state.tm, fill, renderer, state,
            );
        } else {
            crate::text_renderer::render_text_glyphs_skia(
                &bytes, &*font_entry, text_state.font_size,
                text_state.horizontal_scaling, text_state.char_spacing,
                text_state.word_spacing, text_state.rise,
                &mut text_state.tm, fill, renderer, state,
            );
        }
    }

    /// Server-side text-show for the TJ operator. Walks the array, calling
    /// the simple- or CID-glyph painter for every string and applying kern
    /// adjustments for every numeric entry.
    fn execute_show_array(
        operands: &[Object],
        text_state: &mut TextState,
        font_registry: &mut FontRegistry,
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
    ) {
        let arr = match operands.first() {
            Some(Object::Array(a)) => a,
            _ => return,
        };
        let font_entry = match font_registry.get_font(&text_state.current_font_name, doc, resources) {
            Some(fe) => fe,
            None => return,
        };
        if font_entry.parsed.is_none() { return; }
        let is_cid = font_entry.is_cid;
        let fill = state.current.fill_color;

        for item in arr {
            match item {
                Object::String(bytes, _) => {
                    if !bytes.is_empty() {
                        if is_cid {
                            crate::text_renderer::render_cid_text_glyphs_skia(
                                bytes, &*font_entry, text_state.font_size,
                                text_state.horizontal_scaling, text_state.char_spacing,
                                text_state.word_spacing, text_state.rise,
                                &mut text_state.tm, fill, renderer, state,
                            );
                        } else {
                            crate::text_renderer::render_text_glyphs_skia(
                                bytes, &*font_entry, text_state.font_size,
                                text_state.horizontal_scaling, text_state.char_spacing,
                                text_state.word_spacing, text_state.rise,
                                &mut text_state.tm, fill, renderer, state,
                            );
                        }
                    }
                }
                Object::Integer(_) | Object::Real(_) => {
                    text_state.apply_tj_kern(Self::f(item));
                }
                _ => {}
            }
        }
    }

    /// Decode and draw an image XObject. When `max_decode_pixels > 0`,
    /// JPEGs are decoded at reduced resolution via turbojpeg's native
    /// scaled DCT decoding (1/2, 1/4, or 1/8) — this is done during the
    /// decode itself, avoiding full-resolution decode entirely. Non-JPEG
    /// images are decoded at full resolution then box-filtered down.
    fn handle_image_execute(
        stream: &lopdf::Stream,
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        max_decode_pixels: u32,
    ) {
        let dict = &stream.dict;
        let width = Self::read_int(dict, b"Width", doc).unwrap_or(0);
        let height = Self::read_int(dict, b"Height", doc).unwrap_or(0);
        if width == 0 || height == 0 { return; }

        let filter = dict.get(b"Filter").ok().and_then(|o| match o {
            Object::Name(n) => Some(n.clone()),
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                if let Object::Name(n) = o { Some(n.clone()) } else { None }
            }),
            Object::Array(arr) => arr.last().and_then(|o| match o {
                Object::Name(n) => Some(n.clone()),
                _ => None,
            }),
            _ => None,
        });
        let filter_name = filter.as_deref().unwrap_or(b"");
        let is_jpeg = filter_name == b"DCTDecode";

        // ─── JPEG: use turbojpeg with native scaled DCT decoding ─────────
        let (img_w, img_h, mut rgba) = if is_jpeg {
            let raw = &stream.content;
            match Self::decode_jpeg_scaled(raw, max_decode_pixels) {
                Some(result) => result,
                None => return,
            }
        } else {
            // ─── Non-JPEG: raw pixel decode + optional box downsample ────
            match Self::decode_raw_image(dict, stream, doc, width, height, max_decode_pixels) {
                Some(result) => result,
                None => return,
            }
        };

        // ─── Apply /SMask soft alpha for JPEGs ────────────────────────────
        // The non-JPEG path already bakes SMask alpha into the RGBA buffer
        // inside decode_raw_image. The JPEG decoder produces an opaque
        // (a=255) buffer so we must apply the SMask here. Without this,
        // tiled-JPEG photo grids (e.g. Zware vector PDF p3/p5) render with
        // their alpha-edged matte blending discarded — every tile becomes
        // a hard rectangle on a (255,255,255) backdrop instead of softly
        // composited content with a (253,253,253) backdrop bleeding
        // through transparent edge pixels.
        if is_jpeg {
            if let Some((sm_w, sm_h, alpha_bytes)) = Self::read_smask_alpha(dict, doc) {
                Self::premultiply_with_smask(&mut rgba, img_w, img_h, &alpha_bytes, sm_w, sm_h);
            }
        }

        state.save();
        state.concat_matrix(1.0, 0.0, 0.0, -1.0, 0.0, 1.0);
        renderer.draw_image(img_w, img_h, &rgba, &state.current);
        state.restore();
    }

    /// Resolve and decode an Image XObject's `/SMask` soft-alpha mask.
    /// Returns `(sm_width, sm_height, alpha_bytes)` (single byte per pixel,
    /// length = sm_width * sm_height) or `None` if no SMask is present or
    /// the mask cannot be decoded.
    ///
    /// The mask is itself an Image XObject (DeviceGray, 8 bpc) whose pixel
    /// values become the per-pixel alpha for the parent image. /Matte
    /// (un-matting against a background colour) is intentionally ignored;
    /// the silhouette alone matches PyMuPDF's edge-blending closely enough.
    fn read_smask_alpha(dict: &Dictionary, doc: &Document) -> Option<(u32, u32, Vec<u8>)> {
        let stream = match dict.get(b"SMask").ok()? {
            Object::Stream(s) => Some(s.clone()),
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|obj| {
                if let Object::Stream(s) = obj { Some(s.clone()) } else { None }
            }),
            _ => None,
        }?;
        let sm_dict = &stream.dict;
        let sm_w = sm_dict.get(b"Width").ok().and_then(|o| match o {
            Object::Integer(i) => Some(*i as u32),
            _ => None,
        })?;
        let sm_h = sm_dict.get(b"Height").ok().and_then(|o| match o {
            Object::Integer(i) => Some(*i as u32),
            _ => None,
        })?;
        if sm_w == 0 || sm_h == 0 { return None; }

        // Identify the outermost filter — SMasks may be FlateDecode (raw
        // grayscale bytes) or DCTDecode (JPEG-encoded grayscale).
        let filters: Vec<Vec<u8>> = match sm_dict.get(b"Filter").ok() {
            Some(Object::Name(n)) => vec![n.clone()],
            Some(Object::Array(arr)) => arr.iter().filter_map(|o| match o {
                Object::Name(n) => Some(n.clone()),
                _ => None,
            }).collect(),
            _ => Vec::new(),
        };
        let outermost = filters.last().map(|v| v.as_slice()).unwrap_or(&[]);

        let needed = (sm_w as usize) * (sm_h as usize);

        if outermost == b"DCTDecode" {
            // JPEG-encoded grayscale SMask: decode the JPEG and extract
            // the gray channel. turbojpeg returns RGBA for grayscale JPEGs
            // by replicating the gray byte across R/G/B with a=255 — we
            // pull the R channel back out as the alpha source.
            let (jw, jh, rgba) = Self::decode_jpeg_scaled(&stream.content, 0)?;
            if jw != sm_w || jh != sm_h { return None; }
            if rgba.len() < needed * 4 { return None; }
            let mut out = Vec::with_capacity(needed);
            for px in 0..needed { out.push(rgba[px * 4]); }
            return Some((sm_w, sm_h, out));
        }

        // FlateDecode / no filter: decompress to raw grayscale bytes.
        let bytes = Self::decompress_image_stream(&stream)?;
        if bytes.len() < needed { return None; }
        Some((sm_w, sm_h, bytes[..needed].to_vec()))
    }

    /// Apply per-pixel SMask alpha to an opaque RGBA buffer, premultiplying
    /// R/G/B by the alpha (tiny-skia requires premultiplied input).
    /// When the image was downsampled (img_w != sm_w), the mask is
    /// nearest-neighbour resampled onto the image grid.
    ///
    /// PyMuPDF/MuPDF parity note: when the SMask is "dimming-only" (no real
    /// transparency, alpha values stay near 255), we treat it as a colour
    /// attenuation rather than a soft alpha. With a true alpha-comp pipeline,
    /// premultiplied (c=253, a=254) over an opaque-white canvas yields
    /// 253 + 255*(255-254)/255 = 254, but PyMuPDF effectively renders 253
    /// because its straight-output path drops alpha and exposes the
    /// premultiplied colour bytes directly. Forcing alpha=255 for high-alpha
    /// pixels keeps the straight-over-white tiny-skia composite reading the
    /// premul colour without further mixing — matching MuPDF on tiled JPEG
    /// photo grids (Zware vector PDF p0/p2/p3/p4/p5/p6, where every tile
    /// has a uniform-254 SMask used purely as a JPEG-quality dimming pass).
    /// Real cutout SMasks (with alpha values that vary down to 0 / dip below
    /// the threshold) keep the original premultiplied behaviour so soft
    /// edges and silhouettes still composite correctly.
    fn premultiply_with_smask(
        rgba: &mut [u8],
        img_w: u32,
        img_h: u32,
        smask: &[u8],
        sm_w: u32,
        sm_h: u32,
    ) {
        if img_w == 0 || img_h == 0 { return; }
        let same_dims = img_w == sm_w && img_h == sm_h;
        let pm = |c: u8, a: u8| -> u8 { ((c as u16 * a as u16 + 127) / 255) as u8 };

        // Decide whether the mask is a dimming pass (all alpha values >=
        // DIMMING_THRESHOLD) or a real soft mask with cutouts. Sample the
        // mask bytes — for any pixel below the threshold, treat the whole
        // mask as a true cutout. Threshold 250 is conservative: it catches
        // the 254-uniform JPEG-quality masks while still treating any mask
        // with even a hint of real transparency (alpha < 250) as a cutout.
        const DIMMING_THRESHOLD: u8 = 250;
        let mut is_dimming_only = true;
        for &a in smask.iter() {
            if a < DIMMING_THRESHOLD {
                is_dimming_only = false;
                break;
            }
        }

        for dy in 0..img_h {
            for dx in 0..img_w {
                let sm_idx = if same_dims {
                    (dy as usize) * (sm_w as usize) + (dx as usize)
                } else {
                    let sx = ((dx as u64) * (sm_w as u64) / (img_w as u64)) as usize;
                    let sy = ((dy as u64) * (sm_h as u64) / (img_h as u64)) as usize;
                    sy * (sm_w as usize) + sx
                };
                let a = match smask.get(sm_idx) {
                    Some(v) => *v,
                    None => 255,
                };
                let pixel_idx = ((dy as usize) * (img_w as usize) + (dx as usize)) * 4;
                if pixel_idx + 3 >= rgba.len() { return; }
                if is_dimming_only {
                    // Treat the mask as a colour-attenuation pass: pre-darken
                    // RGB and keep alpha=255 so the over-white composite
                    // doesn't add a brightening dst contribution.
                    rgba[pixel_idx]     = pm(rgba[pixel_idx],     a);
                    rgba[pixel_idx + 1] = pm(rgba[pixel_idx + 1], a);
                    rgba[pixel_idx + 2] = pm(rgba[pixel_idx + 2], a);
                    rgba[pixel_idx + 3] = 255;
                } else {
                    // Real cutout / soft mask: premultiply with the alpha as
                    // tiny-skia expects, so transparent edges blend correctly.
                    rgba[pixel_idx]     = pm(rgba[pixel_idx],     a);
                    rgba[pixel_idx + 1] = pm(rgba[pixel_idx + 1], a);
                    rgba[pixel_idx + 2] = pm(rgba[pixel_idx + 2], a);
                    rgba[pixel_idx + 3] = a;
                }
            }
        }
    }

    /// Read an integer from a PDF dict, resolving indirect references.
    fn read_int(dict: &Dictionary, key: &[u8], doc: &Document) -> Option<u32> {
        dict.get(key).ok().and_then(|o| match o {
            Object::Integer(i) => Some(*i as u32),
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                if let Object::Integer(i) = o { Some(*i as u32) } else { None }
            }),
            _ => None,
        })
    }

    /// Decode JPEG with optional pixel-budget downscaling.
    /// Strategy:
    ///  1. Try turbojpeg with native scaled DCT decoding (fastest)
    ///  2. Fall back to `image` crate + box downsample if turbojpeg fails
    fn decode_jpeg_scaled(jpeg_data: &[u8], max_pixels: u32) -> Option<(u32, u32, Vec<u8>)> {
        // ─── Try turbojpeg native scaled decode ──────────────────────────
        if let Some(result) = Self::try_turbojpeg(jpeg_data, max_pixels) {
            return Some(result);
        }

        // ─── Fallback: image crate + post-decode downsample ──────────────
        let img = image::load_from_memory_with_format(jpeg_data, image::ImageFormat::Jpeg).ok()?;
        let img = img.to_rgba8();
        let (w, h) = (img.width(), img.height());
        let mut rgba = img.into_raw();

        // Downsample if over budget
        if max_pixels > 0 && w * h > max_pixels {
            let (new_w, new_h, small) = Self::box_downsample(&rgba, w, h, max_pixels);
            return Some((new_w, new_h, small));
        }
        Some((w, h, rgba))
    }

    /// Try turbojpeg native scaled DCT decode. Returns None on any failure.
    fn try_turbojpeg(jpeg_data: &[u8], max_pixels: u32) -> Option<(u32, u32, Vec<u8>)> {
        let mut dc = turbojpeg::Decompressor::new().ok()?;
        let header = dc.read_header(jpeg_data).ok()?;
        let full_w = header.width;
        let full_h = header.height;

        // Pick scaling factor that fits the pixel budget
        let chosen_factor = if max_pixels > 0 && (full_w * full_h) as u32 > max_pixels {
            let factors = turbojpeg::Decompressor::supported_scaling_factors();
            // factors are sorted largest-first (1/1, 7/8, 3/4, ..., 1/8)
            let mut picked = None;
            for &f in &factors {
                let sw = f.scale(full_w);
                let sh = f.scale(full_h);
                if sw > 0 && sh > 0 && (sw * sh) as u32 <= max_pixels {
                    picked = Some(f);
                    break;
                }
            }
            // If nothing fits, use the smallest
            if picked.is_none() {
                picked = factors.last().copied();
            }
            picked
        } else {
            None
        };

        if let Some(factor) = chosen_factor {
            dc.set_scaling_factor(factor).ok()?;
        }

        // Compute scaled output dimensions using the chosen factor
        let out_w = chosen_factor.map_or(full_w, |f| f.scale(full_w)).max(1);
        let out_h = chosen_factor.map_or(full_h, |f| f.scale(full_h)).max(1);

        let mut image = turbojpeg::Image {
            pixels: vec![0u8; out_w * out_h * 4],
            width: out_w,
            pitch: out_w * 4,
            height: out_h,
            format: turbojpeg::PixelFormat::RGBA,
        };

        dc.decompress(jpeg_data, image.as_deref_mut()).ok()?;
        Some((out_w as u32, out_h as u32, image.pixels))
    }

    /// Fast box-filter downsample of RGBA data to fit a pixel budget.
    fn box_downsample(rgba: &[u8], w: u32, h: u32, max_pixels: u32) -> (u32, u32, Vec<u8>) {
        let ratio = (max_pixels as f64 / (w as f64 * h as f64)).sqrt();
        let nw = ((w as f64 * ratio).ceil() as u32).max(1);
        let nh = ((h as f64 * ratio).ceil() as u32).max(1);
        let sx = w as f64 / nw as f64;
        let sy = h as f64 / nh as f64;
        let mut small = Vec::with_capacity((nw * nh * 4) as usize);
        for dy in 0..nh {
            for dx in 0..nw {
                let src_x = (dx as f64 * sx) as usize;
                let src_y = (dy as f64 * sy) as usize;
                let idx = (src_y * w as usize + src_x) * 4;
                if idx + 3 < rgba.len() {
                    small.extend_from_slice(&rgba[idx..idx + 4]);
                } else {
                    small.extend_from_slice(&[0, 0, 0, 255]);
                }
            }
        }
        (nw, nh, small)
    }

    /// Resolve an Image XObject's `/ColorSpace` entry into per-pixel
    /// component count and (for /Indexed) the lookup palette.
    ///
    /// Returns `(components_per_pixel_in_stream, base_components, palette)`:
    ///   - `components_per_pixel_in_stream`: bytes consumed per pixel from the
    ///     decoded stream. For Indexed this is 1; for Device* it equals the
    ///     base channel count.
    ///   - `base_components`: number of channels in the OUTPUT colour after
    ///     palette lookup (3 for /Indexed /DeviceRGB, 1 for /Indexed
    ///     /DeviceGray, 4 for /Indexed /DeviceCMYK, otherwise same as
    ///     `components_per_pixel_in_stream`).
    ///   - `palette`: when `Some`, the indexed lookup table — a vector of
    ///     `(hival + 1) * base_components` bytes. Each input pixel byte is an
    ///     index into this table.
    ///
    /// Per ISO 32000-1 §8.6.6.3, /Indexed colour spaces have the form
    /// `[/Indexed base hival lookup]` where `lookup` is either a hex/literal
    /// string of `(hival+1) * N` bytes (N = base channels) or a stream.
    fn resolve_color_space(
        dict: &Dictionary,
        doc: &Document,
    ) -> (usize, usize, Option<Vec<u8>>) {
        let cs_obj = match dict.get(b"ColorSpace").ok() {
            Some(o) => o,
            None => return (3, 3, None),
        };
        // Resolve indirect reference to its target object once.
        let resolved: Object = match cs_obj {
            Object::Reference(id) => match doc.get_object(*id) {
                Ok(o) => o.clone(),
                _ => return (3, 3, None),
            },
            other => other.clone(),
        };

        match resolved {
            Object::Name(n) => {
                let comps = match n.as_slice() {
                    b"DeviceCMYK" => 4,
                    b"DeviceGray" | b"CalGray" => 1,
                    _ => 3, // DeviceRGB, CalRGB, default
                };
                (comps, comps, None)
            }
            Object::Array(arr) => {
                let head = arr.first().and_then(|o| {
                    if let Object::Name(n) = o {
                        Some(n.clone())
                    } else {
                        None
                    }
                });
                match head.as_deref() {
                    Some(b"Indexed") => {
                        // [/Indexed base hival lookup]
                        // Determine base channel count.
                        let base = arr.get(1).cloned().and_then(|o| match o {
                            Object::Reference(id) => doc.get_object(id).ok().cloned(),
                            other => Some(other),
                        });
                        let base_components: usize = match base {
                            Some(Object::Name(n)) => match n.as_slice() {
                                b"DeviceCMYK" => 4,
                                b"DeviceGray" | b"CalGray" => 1,
                                _ => 3,
                            },
                            Some(Object::Array(ref ba)) => {
                                // e.g. [/CalRGB <<...>>] or [/ICCBased N]
                                ba.first().and_then(|o| match o {
                                    Object::Name(bn) => Some(match bn.as_slice() {
                                        b"DeviceCMYK" | b"CalCMYK" => 4,
                                        b"DeviceGray" | b"CalGray" => 1,
                                        _ => 3,
                                    }),
                                    _ => None,
                                }).unwrap_or(3)
                            }
                            _ => 3,
                        };
                        // Lookup is either Object::String(_) or Object::Stream(_)
                        let lookup = arr.get(3).cloned().and_then(|o| match o {
                            Object::Reference(id) => doc.get_object(id).ok().cloned(),
                            other => Some(other),
                        });
                        let palette: Option<Vec<u8>> = match lookup {
                            Some(Object::String(bytes, _)) => Some(bytes),
                            Some(Object::Stream(s)) => Self::decompress_image_stream(&s),
                            _ => None,
                        };
                        // Indexed images store 1 byte (palette index) per pixel
                        // when /BitsPerComponent is 8.
                        (1, base_components, palette)
                    }
                    Some(b"CalCMYK") => (4, 4, None),
                    Some(b"DeviceCMYK") => (4, 4, None),
                    Some(b"CalGray") | Some(b"DeviceGray") => (1, 1, None),
                    Some(b"ICCBased") => {
                        // [/ICCBased <stream>] — read /N from the stream dict.
                        let n_chans = arr.get(1).cloned().and_then(|o| match o {
                            Object::Reference(id) => doc.get_object(id).ok().cloned(),
                            other => Some(other),
                        }).and_then(|o| match o {
                            Object::Stream(s) => s.dict.get(b"N").ok().and_then(|n| {
                                if let Object::Integer(i) = n { Some(*i as usize) } else { None }
                            }),
                            _ => None,
                        }).unwrap_or(3);
                        (n_chans, n_chans, None)
                    }
                    _ => (3, 3, None),
                }
            }
            _ => (3, 3, None),
        }
    }

    /// Decode a non-JPEG image (raw/deflated pixel data) with optional
    /// box-filter downsampling when exceeding the pixel budget.
    fn decode_raw_image(
        dict: &Dictionary,
        stream: &lopdf::Stream,
        doc: &Document,
        width: u32,
        height: u32,
        max_pixels: u32,
    ) -> Option<(u32, u32, Vec<u8>)> {
        let bits = dict.get(b"BitsPerComponent").ok()
            .and_then(|o| if let Object::Integer(i) = o { Some(*i as u8) } else { None })
            .unwrap_or(8);
        if bits != 8 { return None; }

        // Resolve colour space — either direct (DeviceRGB/Gray/CMYK) or an
        // [/Indexed base hival lookup] palette wrapper.
        let (stream_components, output_components, palette) =
            Self::resolve_color_space(dict, doc);
        let components: usize = output_components;

        // lopdf 0.34's decompressed_content() returns Err(Type) for /Image
        // streams, so we go through our own decompress_image_stream helper
        // (handles FlateDecode + PNG predictor, raw passthrough otherwise).
        let raw_pixels = Self::decompress_image_stream(stream)?;
        let expected = width as usize * height as usize * stream_components;
        if raw_pixels.len() < expected { return None; }

        // Resolve and decode an /SMask soft-alpha mask if present. We only
        // honour the mask when it's the same resolution as the image —
        // mismatched-dim resampling is left to read_smask_alpha's callers
        // that need it (e.g. JPEG-decoded paths that may downsample).
        // /Matte (un-matting against a background colour) is intentionally
        // ignored for now; the silhouette alone fixes the bulk of the
        // black-rectangle artefact on rapport-constructie / Text pdf
        // gecombineerd PDFs.
        let smask_alpha: Option<Vec<u8>> = Self::read_smask_alpha(dict, doc)
            .and_then(|(sm_w, sm_h, bytes)| {
                if sm_w == width && sm_h == height { Some(bytes) } else { None }
            });

        // Determine output size — downsample if over budget
        let (out_w, out_h, step_x, step_y) = if max_pixels > 0 && width * height > max_pixels {
            let ratio = (max_pixels as f64 / (width as f64 * height as f64)).sqrt();
            let nw = ((width as f64 * ratio).ceil() as u32).max(1);
            let nh = ((height as f64 * ratio).ceil() as u32).max(1);
            (nw, nh, width as f64 / nw as f64, height as f64 / nh as f64)
        } else {
            (width, height, 1.0, 1.0)
        };

        // tiny-skia's `PixmapRef::from_bytes` requires PREMULTIPLIED RGBA —
        // it returns None if r/g/b > a for any pixel. Premultiply when
        // baking the per-pixel alpha so transparent regions of the SMask
        // (alpha == 0) become fully transparent black instead of being
        // rejected by the pixmap loader.
        let pm = |c: u8, a: u8| -> u8 { ((c as u16 * a as u16 + 127) / 255) as u8 };

        let mut rgba = Vec::with_capacity((out_w * out_h * 4) as usize);
        for dy in 0..out_h {
            for dx in 0..out_w {
                let src_x = (dx as f64 * step_x) as usize;
                let src_y = (dy as f64 * step_y) as usize;
                let src_idx = src_y * width as usize + src_x;
                let idx = src_idx * stream_components;
                let alpha = smask_alpha
                    .as_ref()
                    .and_then(|a| a.get(src_idx).copied())
                    .unwrap_or(255);

                // For Indexed colour spaces, expand the palette index into a
                // base-colour-space tuple before the same RGBA conversion path
                // that direct DeviceRGB/Gray/CMYK pixels go through.
                let mut buf: [u8; 4] = [0; 4];
                let comp_slice: &[u8] = if let Some(pal) = palette.as_ref() {
                    let pi = raw_pixels[idx] as usize;
                    let p_off = pi * components;
                    if p_off + components <= pal.len() {
                        for i in 0..components { buf[i] = pal[p_off + i]; }
                        &buf[..components]
                    } else {
                        // Palette too short — fall back to opaque-grey on miss.
                        for i in 0..components { buf[i] = 0; }
                        &buf[..components]
                    }
                } else {
                    &raw_pixels[idx .. idx + stream_components]
                };

                match components {
                    1 => {
                        let g = comp_slice[0];
                        let g2 = pm(g, alpha);
                        rgba.extend_from_slice(&[g2, g2, g2, alpha]);
                    }
                    3 => {
                        rgba.extend_from_slice(&[
                            pm(comp_slice[0], alpha),
                            pm(comp_slice[1], alpha),
                            pm(comp_slice[2], alpha),
                            alpha,
                        ]);
                    }
                    4 => {
                        let c = comp_slice[0] as f32 / 255.0;
                        let m = comp_slice[1] as f32 / 255.0;
                        let y = comp_slice[2] as f32 / 255.0;
                        let k = comp_slice[3] as f32 / 255.0;
                        let r = (255.0 * (1.0 - c) * (1.0 - k)) as u8;
                        let g = (255.0 * (1.0 - m) * (1.0 - k)) as u8;
                        let b = (255.0 * (1.0 - y) * (1.0 - k)) as u8;
                        rgba.extend_from_slice(&[
                            pm(r, alpha),
                            pm(g, alpha),
                            pm(b, alpha),
                            alpha,
                        ]);
                    }
                    _ => { rgba.extend_from_slice(&[0, 0, 0, alpha]); }
                }
            }
        }
        Some((out_w, out_h, rgba))
    }

    pub fn extract_commands(
        content_bytes: &[u8],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) -> Result<(), RenderError> {
        Self::extract_commands_with_text(content_bytes, buf, state, doc, resources, font_registry, None)
    }

    pub fn extract_commands_with_text(
        content_bytes: &[u8],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
        mut text_spans: Option<&mut Vec<TextSpan>>,
    ) -> Result<(), RenderError> {
        let content = Content::decode(content_bytes)
            .map_err(|e| RenderError::ParseError(format!("Content decode: {}", e)))?;

        let mut has_active_path = false;
        let mut text_state = TextState::new();

        for op in &content.operations {
            match op.operator.as_str() {
                // Graphics state
                "q" => {
                    state.save();
                    buf.save_state();
                }
                "Q" => {
                    state.restore();
                    buf.restore_state();
                }
                "cm" => {
                    if op.operands.len() >= 6 {
                        let a = Self::f(&op.operands[0]);
                        let b = Self::f(&op.operands[1]);
                        let c = Self::f(&op.operands[2]);
                        let d = Self::f(&op.operands[3]);
                        let e = Self::f(&op.operands[4]);
                        let f = Self::f(&op.operands[5]);
                        state.concat_matrix(a, b, c, d, e, f);
                        buf.transform(a, b, c, d, e, f);
                    }
                }
                "w" => {
                    if let Some(w) = op.operands.first() {
                        state.current.line_width = Self::f(w);
                    }
                }
                "J" => {
                    if let Some(v) = op.operands.first() {
                        let cap = Self::i(v) as u8;
                        state.current.line_cap = cap;
                        buf.set_line_cap(cap);
                    }
                }
                "j" => {
                    if let Some(v) = op.operands.first() {
                        let join = Self::i(v) as u8;
                        state.current.line_join = join;
                        buf.set_line_join(join);
                    }
                }
                "M" => {
                    if let Some(v) = op.operands.first() {
                        let ml = Self::f(v);
                        state.current.miter_limit = ml;
                        buf.set_miter_limit(ml);
                    }
                }
                "d" => {
                    if op.operands.len() >= 2 {
                        if let Object::Array(arr) = &op.operands[0] {
                            state.current.dash_array = arr.iter().map(|o| Self::f(o)).collect();
                        }
                        state.current.dash_phase = Self::f(&op.operands[1]);
                        buf.set_dash(&state.current.dash_array, state.current.dash_phase);
                    }
                }
                // Color - grayscale
                "g" => {
                    if let Some(v) = op.operands.first() {
                        let (r, g, b) = color::gray_to_rgb(Self::f(v));
                        state.current.fill_color = (r, g, b, 255);
                    }
                }
                "G" => {
                    if let Some(v) = op.operands.first() {
                        let (r, g, b) = color::gray_to_rgb(Self::f(v));
                        state.current.stroke_color = (r, g, b, 255);
                    }
                }
                // Color - RGB
                "rg" => {
                    if op.operands.len() >= 3 {
                        state.current.fill_color = color::rgb_to_rgba8(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                        );
                    }
                }
                "RG" => {
                    if op.operands.len() >= 3 {
                        state.current.stroke_color = color::rgb_to_rgba8(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                        );
                    }
                }
                // Color - CMYK
                "k" => {
                    if op.operands.len() >= 4 {
                        let (r, g, b) = color::cmyk_to_rgb(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                            Self::f(&op.operands[3]),
                        );
                        state.current.fill_color = (r, g, b, 255);
                    }
                }
                "K" => {
                    if op.operands.len() >= 4 {
                        let (r, g, b) = color::cmyk_to_rgb(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                            Self::f(&op.operands[3]),
                        );
                        state.current.stroke_color = (r, g, b, 255);
                    }
                }
                // Color - colorspace operators
                "sc" | "scn" => {
                    match op.operands.len() {
                        3 => {
                            state.current.fill_color = color::rgb_to_rgba8(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                            );
                        }
                        1 => {
                            let (r, g, b) = color::gray_to_rgb(Self::f(&op.operands[0]));
                            state.current.fill_color = (r, g, b, 255);
                        }
                        4 => {
                            let (r, g, b) = color::cmyk_to_rgb(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                                Self::f(&op.operands[3]),
                            );
                            state.current.fill_color = (r, g, b, 255);
                        }
                        _ => {}
                    }
                }
                "SC" | "SCN" => {
                    match op.operands.len() {
                        3 => {
                            state.current.stroke_color = color::rgb_to_rgba8(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                            );
                        }
                        1 => {
                            let (r, g, b) = color::gray_to_rgb(Self::f(&op.operands[0]));
                            state.current.stroke_color = (r, g, b, 255);
                        }
                        4 => {
                            let (r, g, b) = color::cmyk_to_rgb(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                                Self::f(&op.operands[3]),
                            );
                            state.current.stroke_color = (r, g, b, 255);
                        }
                        _ => {}
                    }
                }
                "cs" | "CS" => {}
                // Path construction
                "m" => {
                    if op.operands.len() >= 2 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.move_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
                    }
                }
                "l" => {
                    if op.operands.len() >= 2 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.line_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
                    }
                }
                "c" => {
                    if op.operands.len() >= 6 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "v" => {
                    // v x2 y2 x3 y3: cubic bezier where first control point = current point
                    // We don't track the current point here, so we approximate by using
                    // (x2,y2) as both control points (same as the existing behavior).
                    // A perfect implementation would track the current path position.
                    if op.operands.len() >= 4 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "y" => {
                    if op.operands.len() >= 4 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "re" => {
                    if op.operands.len() >= 4 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.rect(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "h" => {
                    buf.close_path();
                }
                // Path painting
                "S" => {
                    let (r, g, b, a) = state.current.stroke_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_stroke(rgba, state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "s" => {
                    buf.close_path();
                    let (r, g, b, a) = state.current.stroke_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_stroke(rgba, state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "f" | "F" => {
                    let (r, g, b, a) = state.current.fill_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_fill(rgba);
                    buf.fill();
                    has_active_path = false;
                }
                "f*" => {
                    let (r, g, b, a) = state.current.fill_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_fill(rgba);
                    buf.fill_even_odd();
                    has_active_path = false;
                }
                "B" => {
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "B*" => {
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill_even_odd();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "b" => {
                    buf.close_path();
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "b*" => {
                    buf.close_path();
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill_even_odd();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "n" => {
                    has_active_path = false;
                }
                // Clipping — apply current path as clipping region
                "W" => {
                    buf.clip();
                }
                "W*" => {
                    buf.clip_even_odd();
                }
                // Text operators
                "BT" => {
                    text_state.begin_text();
                }
                "ET" => {
                    text_state.in_text = false;
                }
                "Tf" => {
                    if op.operands.len() >= 2 {
                        if let Object::Name(ref name_bytes) = op.operands[0] {
                            text_state.current_font_name =
                                String::from_utf8_lossy(name_bytes).to_string();
                        }
                        text_state.font_size = Self::f(&op.operands[1]);
                    }
                }
                "TL" => {
                    if let Some(v) = op.operands.first() {
                        text_state.leading = Self::f(v);
                    }
                }
                "Td" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.translate_line(tx, ty);
                    }
                }
                "TD" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.leading = -ty;
                        text_state.translate_line(tx, ty);
                    }
                }
                "Tm" => {
                    if op.operands.len() >= 6 {
                        text_state.set_text_matrix(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                            Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]),
                            Self::f(&op.operands[5]),
                        );
                    }
                }
                "T*" => {
                    text_state.translate_line(0.0, -text_state.leading);
                }
                "Tj" => {
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            let (r, g, b, a) = state.current.fill_color;
                            let rgba = Self::color_to_u32(r, g, b, a);
                            // get_font now returns Arc<FontEntry> from a
                            // document-scoped cache. Cheap for shared fonts
                            // already seen on previous pages.
                            if let Some(font_entry) = font_registry.get_font(
                                &text_state.current_font_name, doc, resources,
                            ) {
                                // Capture position before rendering for text span
                                let start_x = text_state.render_x();
                                let start_y = text_state.render_y();
                                if font_entry.is_cid && font_entry.parsed.is_some() {
                                    if let Some(ref mut spans) = text_spans {
                                        let decoded = Self::decode_cid_text(bytes, &*font_entry);
                                        if !decoded.trim().is_empty() {
                                            let pre_x = text_state.tm[4];
                                            crate::text_renderer::render_cid_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                            let width = (text_state.tm[4] - pre_x).abs();
                                            spans.push(TextSpan {
                                                x: start_x, y: start_y,
                                                width, height: text_state.font_size.abs(),
                                                font_size: text_state.font_size.abs(),
                                                text: decoded,
                                            });
                                        } else {
                                            crate::text_renderer::render_cid_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                        }
                                    } else {
                                        crate::text_renderer::render_cid_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                    }
                                } else if font_entry.parsed.is_some() {
                                    if let Some(ref mut spans) = text_spans {
                                        let decoded = Self::decode_simple_text(bytes, &*font_entry);
                                        if !decoded.trim().is_empty() {
                                            let pre_x = text_state.tm[4];
                                            crate::text_renderer::render_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                            let width = (text_state.tm[4] - pre_x).abs();
                                            spans.push(TextSpan {
                                                x: start_x, y: start_y,
                                                width, height: text_state.font_size.abs(),
                                                font_size: text_state.font_size.abs(),
                                                text: decoded,
                                            });
                                        } else {
                                            crate::text_renderer::render_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                        }
                                    } else {
                                        crate::text_renderer::render_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                    }
                                }
                                // No parsed font data → skip (TextAt
                                // fallback would mis-position the text).
                            }
                        }
                    }
                }
                "TJ" => {
                    if let Some(Object::Array(arr)) = op.operands.first() {
                        let (r, g, b, a) = state.current.fill_color;
                        let rgba = Self::color_to_u32(r, g, b, a);
                        // Fetch the font ONCE for the whole TJ array — Arc
                        // makes it trivial to hold across the loop instead
                        // of re-fetching per string like the old code did.
                        let font_entry_opt = font_registry.get_font(
                            &text_state.current_font_name, doc, resources,
                        );
                        if let Some(font_entry) = font_entry_opt {
                            if font_entry.parsed.is_some() {
                                let is_cid = font_entry.is_cid;
                                // For TJ arrays, collect all string parts into one span per run
                                let collecting = text_spans.is_some();
                                let mut run_text = if collecting { String::new() } else { String::new() };
                                let run_start_x = text_state.render_x();
                                let run_start_y = text_state.render_y();
                                let pre_x = text_state.tm[4];

                                for item in arr {
                                    match item {
                                        Object::String(bytes, _) => {
                                            if !bytes.is_empty() {
                                                if collecting {
                                                    if is_cid {
                                                        run_text.push_str(&Self::decode_cid_text(bytes, &*font_entry));
                                                    } else {
                                                        run_text.push_str(&Self::decode_simple_text(bytes, &*font_entry));
                                                    }
                                                }
                                                if is_cid {
                                                    crate::text_renderer::render_cid_text_glyphs(
                                                        bytes, &*font_entry, text_state.font_size,
                                                        text_state.horizontal_scaling, text_state.char_spacing,
                                                        text_state.word_spacing, text_state.rise,
                                                        &mut text_state.tm, rgba, buf,
                                                    );
                                                } else {
                                                    crate::text_renderer::render_text_glyphs(
                                                        bytes, &*font_entry, text_state.font_size,
                                                        text_state.horizontal_scaling, text_state.char_spacing,
                                                        text_state.word_spacing, text_state.rise,
                                                        &mut text_state.tm, rgba, buf,
                                                    );
                                                }
                                            }
                                        }
                                        Object::Integer(_) | Object::Real(_) => {
                                            let kern = Self::f(item);
                                            text_state.apply_tj_kern(kern);
                                        }
                                        _ => {}
                                    }
                                }

                                if let Some(ref mut spans) = text_spans {
                                    if !run_text.trim().is_empty() {
                                        let width = (text_state.tm[4] - pre_x).abs();
                                        spans.push(TextSpan {
                                            x: run_start_x, y: run_start_y,
                                            width, height: text_state.font_size.abs(),
                                            font_size: text_state.font_size.abs(),
                                            text: run_text,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
                "'" => {
                    // ' is equivalent to: T* then Tj
                    text_state.translate_line(0.0, -text_state.leading);
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            let (r, g, b, a) = state.current.fill_color;
                            let rgba = Self::color_to_u32(r, g, b, a);
                            if let Some(font_entry) = font_registry.get_font(
                                &text_state.current_font_name, doc, resources,
                            ) {
                                let start_x = text_state.render_x();
                                let start_y = text_state.render_y();
                                if let Some(ref mut spans) = text_spans {
                                    let decoded = Self::decode_simple_text(bytes, &*font_entry);
                                    let pre_x = text_state.tm[4];
                                    crate::text_renderer::render_text_glyphs(
                                        bytes, &*font_entry, text_state.font_size,
                                        text_state.horizontal_scaling, text_state.char_spacing,
                                        text_state.word_spacing, text_state.rise,
                                        &mut text_state.tm, rgba, buf,
                                    );
                                    if !decoded.trim().is_empty() {
                                        let width = (text_state.tm[4] - pre_x).abs();
                                        spans.push(TextSpan {
                                            x: start_x, y: start_y,
                                            width, height: text_state.font_size.abs(),
                                            font_size: text_state.font_size.abs(),
                                            text: decoded,
                                        });
                                    }
                                } else {
                                    crate::text_renderer::render_text_glyphs(
                                        bytes, &*font_entry, text_state.font_size,
                                        text_state.horizontal_scaling, text_state.char_spacing,
                                        text_state.word_spacing, text_state.rise,
                                        &mut text_state.tm, rgba, buf,
                                    );
                                }
                            }
                        }
                    }
                }
                "\"" => {
                    // " is equivalent to: Tw Tc T* Tj
                    if op.operands.len() >= 3 {
                        text_state.word_spacing = Self::f(&op.operands[0]);
                        text_state.char_spacing = Self::f(&op.operands[1]);
                        text_state.translate_line(0.0, -text_state.leading);
                        if let Object::String(bytes, _) = &op.operands[2] {
                            if !bytes.is_empty() {
                                let (r, g, b, a) = state.current.fill_color;
                                let rgba = Self::color_to_u32(r, g, b, a);
                                if let Some(font_entry) = font_registry.get_font(
                                    &text_state.current_font_name, doc, resources,
                                ) {
                                    let start_x = text_state.render_x();
                                    let start_y = text_state.render_y();
                                    if let Some(ref mut spans) = text_spans {
                                        let decoded = Self::decode_simple_text(bytes, &*font_entry);
                                        let pre_x = text_state.tm[4];
                                        crate::text_renderer::render_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                        if !decoded.trim().is_empty() {
                                            let width = (text_state.tm[4] - pre_x).abs();
                                            spans.push(TextSpan {
                                                x: start_x, y: start_y,
                                                width, height: text_state.font_size.abs(),
                                                font_size: text_state.font_size.abs(),
                                                text: decoded,
                                            });
                                        }
                                    } else {
                                        crate::text_renderer::render_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                "Tc" => {
                    if let Some(v) = op.operands.first() {
                        text_state.char_spacing = Self::f(v);
                    }
                }
                "Tw" => {
                    if let Some(v) = op.operands.first() {
                        text_state.word_spacing = Self::f(v);
                    }
                }
                "Tz" => {
                    if let Some(v) = op.operands.first() {
                        text_state.horizontal_scaling = Self::f(v) / 100.0;
                    }
                }
                "Ts" => {
                    if let Some(v) = op.operands.first() {
                        text_state.rise = Self::f(v);
                    }
                }
                "Tr" => {}
                "Do" => {
                    Self::handle_do_extract_with_text(&op.operands, buf, state, doc, resources, font_registry, text_spans.as_deref_mut());
                }
                "gs" | "ri" | "i" => {}
                _ => {}
            }
        }
        Ok(())
    }

    /// Decode single-byte text bytes to Unicode using font ToUnicode map or encoding
    fn decode_simple_text(bytes: &[u8], font_entry: &crate::fonts::FontEntry) -> String {
        let mut result = String::new();
        for &b in bytes {
            if let Some(&ch) = font_entry.to_unicode.get(&b) {
                result.push(ch);
            } else if font_entry.encoding_name.is_some() || !font_entry.differences.is_empty() {
                let ch = crate::encoding::resolve_char_code(
                    font_entry.encoding_name.as_deref(),
                    &font_entry.differences,
                    b,
                );
                result.push(ch);
            } else {
                // Fallback: interpret as Latin-1
                result.push(b as char);
            }
        }
        result
    }

    /// Decode CID (2-byte) text bytes to Unicode using font ToUnicode map
    fn decode_cid_text(bytes: &[u8], font_entry: &crate::fonts::FontEntry) -> String {
        let mut result = String::new();
        let mut i = 0;
        while i + 1 < bytes.len() {
            let hi = bytes[i];
            let lo = bytes[i + 1];
            i += 2;
            let cid = u16::from_be_bytes([hi, lo]);
            // Try CID-specific ToUnicode map first (2-byte keys)
            if let Some(&ch) = font_entry.cid_to_unicode.get(&cid) {
                result.push(ch);
            } else if let Some(&ch) = font_entry.to_unicode.get(&(cid as u8)) {
                // Fallback to single-byte ToUnicode (for codes <= 255)
                result.push(ch);
            } else {
                // Treat 2-byte value as Unicode codepoint directly (Identity-H)
                let codepoint = cid as u32;
                if let Some(ch) = char::from_u32(codepoint) {
                    if !ch.is_control() || ch == ' ' {
                        result.push(ch);
                    }
                }
            }
        }
        result
    }

    #[allow(dead_code)]
    fn decode_pdf_string(obj: &Object) -> String {
        match obj {
            Object::String(bytes, _) => String::from_utf8_lossy(bytes).into_owned(),
            _ => String::new(),
        }
    }

    fn color_to_u32(r: u8, g: u8, b: u8, a: u8) -> u32 {
        (r as u32) << 24 | (g as u32) << 16 | (b as u32) << 8 | (a as u32)
    }

    fn f(obj: &Object) -> f32 {
        match obj {
            Object::Real(r) => *r as f32,
            Object::Integer(i) => *i as f32,
            _ => 0.0,
        }
    }

    fn i(obj: &Object) -> i32 {
        match obj {
            Object::Integer(i) => *i as i32,
            Object::Real(r) => *r as i32,
            _ => 0,
        }
    }

    fn handle_do_extract(
        operands: &[Object],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) {
        Self::handle_do_extract_with_text(operands, buf, state, doc, resources, font_registry, None);
    }

    fn handle_do_extract_with_text(
        operands: &[Object],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
        text_spans: Option<&mut Vec<TextSpan>>,
    ) {
        let name = match operands.first() {
            Some(Object::Name(n)) => n,
            _ => return,
        };
        let xobj_dict = match resources.get(b"XObject").and_then(|o| Self::resolve_dict(o, doc)) {
            Ok(d) => d,
            _ => return,
        };
        let obj_ref = match xobj_dict.get(name.as_slice()) {
            Ok(o) => o,
            _ => return,
        };
        let resolved_id = match obj_ref {
            Object::Reference(id) => *id,
            _ => return,
        };
        let obj = match doc.get_object(resolved_id) {
            Ok(o) => o,
            _ => return,
        };
        let stream = match obj {
            Object::Stream(ref s) => s,
            _ => return,
        };
        let subtype = stream.dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok());

        if subtype == Some(b"Image" as &[u8]) {
            Self::handle_image_xobject(stream, buf, doc);
            return;
        }

        if subtype != Some(b"Form" as &[u8]) {
            return;
        }
        buf.save_state();
        state.save();
        if let Ok(matrix) = stream.dict.get(b"Matrix") {
            if let Ok(arr) = matrix.as_array() {
                if arr.len() >= 6 {
                    let a = Self::f(&arr[0]);
                    let b_val = Self::f(&arr[1]);
                    let c = Self::f(&arr[2]);
                    let d = Self::f(&arr[3]);
                    let e = Self::f(&arr[4]);
                    let f = Self::f(&arr[5]);
                    buf.transform(a, b_val, c, d, e, f);
                    state.concat_matrix(a, b_val, c, d, e, f);
                }
            }
        }
        let form_resources = Self::extract_form_resources(&stream.dict, doc);
        let res = form_resources.as_ref().unwrap_or(resources);
        if let Ok(content_bytes) = stream.decompressed_content() {
            let _ = Self::extract_commands_with_text(&content_bytes, buf, state, doc, res, font_registry, text_spans);
        }
        state.restore();
        buf.restore_state();
    }

    /// Decompress an Image XObject stream's content. lopdf 0.34's
    /// `decompressed_content()` deliberately returns `Err(Type)` when the stream's
    /// `/Subtype` is `/Image` (it expects Image streams to be passed through a
    /// dedicated image-decoding pipeline). For our purposes we just need the
    /// raw decoded pixel bytes, so we replicate FlateDecode + PNG-predictor 15
    /// (and the no-filter passthrough) ourselves. JPEG/JPX images are handled
    /// separately by the callers — this helper is only for raw/Flate streams.
    fn decompress_image_stream(stream: &lopdf::Stream) -> Option<Vec<u8>> {
        use std::io::Read;
        let dict = &stream.dict;
        let filters: Vec<String> = match dict.get(b"Filter").ok() {
            Some(Object::Name(n)) => vec![String::from_utf8_lossy(n).into_owned()],
            Some(Object::Array(arr)) => arr.iter().filter_map(|o| match o {
                Object::Name(n) => Some(String::from_utf8_lossy(n).into_owned()),
                _ => None,
            }).collect(),
            _ => Vec::new(),
        };

        // No filter: data is raw pixels already.
        if filters.is_empty() {
            return Some(stream.content.clone());
        }

        // Only handle FlateDecode here; DCTDecode/JPXDecode are caller's job.
        let outermost = filters.last().map(|s| s.as_str()).unwrap_or("");
        if outermost != "FlateDecode" {
            return None;
        }

        let mut decoder = flate2::read::ZlibDecoder::new(stream.content.as_slice());
        let mut decoded = Vec::with_capacity(stream.content.len() * 4);
        if decoder.read_to_end(&mut decoded).is_err() {
            return None;
        }

        // Apply PNG predictor (DecodeParms /Predictor >= 10).
        let params = dict.get(b"DecodeParms").ok().and_then(|o| match o {
            Object::Dictionary(d) => Some(d),
            _ => None,
        });
        let predictor = params
            .and_then(|p| p.get(b"Predictor").ok())
            .and_then(|o| if let Object::Integer(i) = o { Some(*i) } else { None })
            .unwrap_or(1);

        if (10..=15).contains(&predictor) {
            let columns = params
                .and_then(|p| p.get(b"Columns").ok())
                .and_then(|o| if let Object::Integer(i) = o { Some(*i as usize) } else { None })
                .unwrap_or(1)
                .max(1);
            let colors = params
                .and_then(|p| p.get(b"Colors").ok())
                .and_then(|o| if let Object::Integer(i) = o { Some(*i as usize) } else { None })
                .unwrap_or(1)
                .max(1);
            let bpc = params
                .and_then(|p| p.get(b"BitsPerComponent").ok())
                .and_then(|o| if let Object::Integer(i) = o { Some(*i as usize) } else { None })
                .unwrap_or(8)
                .max(8);
            let bytes_per_pixel = (colors * bpc) / 8;
            let row_bytes = columns * bytes_per_pixel;
            let stride = row_bytes + 1; // +1 filter tag per row
            let n_rows = decoded.len() / stride;
            let mut out = Vec::with_capacity(n_rows * row_bytes);
            let mut prev_row = vec![0u8; row_bytes];
            for r in 0..n_rows {
                let row_start = r * stride;
                if row_start + stride > decoded.len() { break; }
                let filter_tag = decoded[row_start];
                let row = &decoded[row_start + 1 .. row_start + stride];
                let mut current = vec![0u8; row_bytes];
                match filter_tag {
                    0 => { current.copy_from_slice(row); }
                    1 => {
                        // Sub: each byte = row[i] + current[i - bpp]
                        for i in 0..row_bytes {
                            let left = if i >= bytes_per_pixel { current[i - bytes_per_pixel] } else { 0 };
                            current[i] = row[i].wrapping_add(left);
                        }
                    }
                    2 => {
                        // Up: each byte = row[i] + prev_row[i]
                        for i in 0..row_bytes {
                            current[i] = row[i].wrapping_add(prev_row[i]);
                        }
                    }
                    3 => {
                        // Average: row[i] + floor((left + up) / 2)
                        for i in 0..row_bytes {
                            let left = if i >= bytes_per_pixel { current[i - bytes_per_pixel] as u16 } else { 0 };
                            let up = prev_row[i] as u16;
                            current[i] = row[i].wrapping_add(((left + up) / 2) as u8);
                        }
                    }
                    4 => {
                        // Paeth
                        for i in 0..row_bytes {
                            let left = if i >= bytes_per_pixel { current[i - bytes_per_pixel] as i32 } else { 0 };
                            let up = prev_row[i] as i32;
                            let upleft = if i >= bytes_per_pixel { prev_row[i - bytes_per_pixel] as i32 } else { 0 };
                            let p = left + up - upleft;
                            let pa = (p - left).abs();
                            let pb = (p - up).abs();
                            let pc = (p - upleft).abs();
                            let pred = if pa <= pb && pa <= pc { left }
                                       else if pb <= pc { up }
                                       else { upleft };
                            current[i] = row[i].wrapping_add(pred as u8);
                        }
                    }
                    _ => { current.copy_from_slice(row); }
                }
                out.extend_from_slice(&current);
                prev_row = current;
            }
            return Some(out);
        }

        Some(decoded)
    }

    /// Handle an Image XObject: decode image data and emit DrawImage command.
    /// PDF images live in a 1×1 unit square — the CTM (already on the canvas stack
    /// via cm operators) scales them to the correct page position and size.
    fn handle_image_xobject(
        stream: &lopdf::Stream,
        buf: &mut DrawCommandBuffer,
        doc: &Document,
    ) {
        let dict = &stream.dict;

        let width = dict.get(b"Width")
            .ok()
            .and_then(|o| match o {
                Object::Integer(i) => Some(*i as u16),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                    if let Object::Integer(i) = o { Some(*i as u16) } else { None }
                }),
                _ => None,
            })
            .unwrap_or(0);
        let height = dict.get(b"Height")
            .ok()
            .and_then(|o| match o {
                Object::Integer(i) => Some(*i as u16),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                    if let Object::Integer(i) = o { Some(*i as u16) } else { None }
                }),
                _ => None,
            })
            .unwrap_or(0);

        if width == 0 || height == 0 {
            return;
        }

        // Resolve and decode an /SMask soft-alpha mask, if present. The mask
        // is an Image XObject in DeviceGray (8 bpc) whose pixel values become
        // the per-pixel alpha for this image. PDF spec 8.5.4: a SMask whose
        // dimensions equal the parent image's gives a 1:1 alpha lookup; we
        // ignore /Matte (un-matting against the matte colour) for this
        // iteration — the silhouette accounts for the bulk of the visual diff.
        // Returns Some(alpha_bytes) when we have width*height single-byte
        // values usable as the RGBA `a` channel, otherwise None.
        let smask_alpha: Option<Vec<u8>> = dict.get(b"SMask").ok().and_then(|o| {
            let stream = match o {
                Object::Stream(s) => Some(s.clone()),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|obj| {
                    if let Object::Stream(s) = obj { Some(s.clone()) } else { None }
                }),
                _ => None,
            }?;
            let sm_dict = &stream.dict;
            let sm_w = sm_dict.get(b"Width").ok().and_then(|o| match o {
                Object::Integer(i) => Some(*i as u32),
                _ => None,
            })?;
            let sm_h = sm_dict.get(b"Height").ok().and_then(|o| match o {
                Object::Integer(i) => Some(*i as u32),
                _ => None,
            })?;
            // Bail out if the mask is not the same resolution as the image —
            // resampling is a future improvement; misaligned alpha would be
            // worse than no alpha.
            if sm_w != width as u32 || sm_h != height as u32 {
                return None;
            }
            let bytes = Self::decompress_image_stream(&stream)?;
            let needed = (sm_w as usize) * (sm_h as usize);
            if bytes.len() < needed {
                return None;
            }
            Some(bytes[..needed].to_vec())
        });

        // Detect filter to determine image format
        let filter = dict.get(b"Filter").ok().and_then(|o| {
            match o {
                Object::Name(n) => Some(n.clone()),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                    if let Object::Name(n) = o { Some(n.clone()) } else { None }
                }),
                Object::Array(arr) => {
                    // Multiple filters — use the last one (outermost)
                    arr.last().and_then(|o| match o {
                        Object::Name(n) => Some(n.clone()),
                        _ => None,
                    })
                }
                _ => None,
            }
        });

        let filter_name = filter.as_deref().unwrap_or(b"");

        if filter_name == b"DCTDecode" {
            // JPEG — send raw bytes directly (browser decodes via hardware-accelerated createImageBitmap)
            // stream.content contains the raw JPEG bytes before lopdf's decompression
            let raw_content = &stream.content;
            if !raw_content.is_empty() && raw_content.len() > 2
                && raw_content[0] == 0xFF && raw_content[1] == 0xD8 {
                buf.save_state();
                buf.transform(1.0, 0.0, 0.0, -1.0, 0.0, 1.0); // flip Y (images are top-down)
                buf.draw_image(width, height, raw_content);
                buf.restore_state();
                return;
            }
        }

        if filter_name == b"JPXDecode" {
            // JPEG 2000 — send raw bytes, browser may support it
            let raw_content = &stream.content;
            if !raw_content.is_empty() {
                buf.save_state();
                buf.transform(1.0, 0.0, 0.0, -1.0, 0.0, 1.0);
                buf.draw_image(width, height, raw_content);
                buf.restore_state();
                return;
            }
        }

        // For FlateDecode or no filter: decompress and encode as PNG
        let bits = dict.get(b"BitsPerComponent")
            .ok()
            .and_then(|o| match o {
                Object::Integer(i) => Some(*i as u8),
                _ => None,
            })
            .unwrap_or(8);

        // Resolve colour space — direct names or /Indexed palettes per
        // PDF spec §8.6.6.3 (see resolve_color_space helper).
        let (stream_components_us, output_components_us, palette) =
            Self::resolve_color_space(dict, doc);
        let stream_components: u8 = stream_components_us as u8;
        let components: u8 = output_components_us as u8;

        // NOTE: must NOT call stream.decompressed_content() here — lopdf 0.34
        // explicitly returns Err(Type) for streams whose Subtype is /Image,
        // which previously caused every FlateDecode raster image to be
        // silently dropped from the draw-command buffer (visible symptom:
        // missing rasters on Bluebeam/AutoCAD/Revit-exported PDFs).
        if let Some(raw_pixels) = Self::decompress_image_stream(stream) {
            if bits == 8 {
                // Convert raw pixels to RGBA and encode as simple bitmap
                let expected_len = width as usize * height as usize * stream_components as usize;
                if raw_pixels.len() >= expected_len {
                    // Build RGBA buffer. When an /SMask supplied per-pixel
                    // alpha, plug those bytes into the `a` slot so transparent
                    // regions (alpha == 0) drop out instead of painting solid
                    // RGB. Without this, images that rely on a soft mask
                    // (cover pages, drop-shadowed logos) render with the
                    // background-bleed pre-matte showing through as solid
                    // black, which dominated the page-0/27 diff on the
                    // rapport-constructie / Text pdf gecombineerd PDFs.
                    // tiny-skia (used by the server-side rasteriser) requires
                    // PREMULTIPLIED RGBA — `PixmapRef::from_bytes` returns
                    // None if r/g/b > a for any pixel. The browser-side
                    // canvas path treats the same blob as straight RGBA but
                    // either way the conversion produces correct pixels (a==
                    // 255 → premultiplied == straight; a < 255 → both pipes
                    // can recover the source colour). So premultiply here.
                    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
                    let mut i = 0;
                    let n_pixels = width as usize * height as usize;
                    let pm = |c: u8, a: u8| -> u8 {
                        ((c as u16 * a as u16 + 127) / 255) as u8
                    };
                    let pal_chunk = components as usize;
                    let mut pal_buf: [u8; 4] = [0; 4];
                    for px in 0..n_pixels {
                        let alpha = smask_alpha
                            .as_ref()
                            .and_then(|a| a.get(px).copied())
                            .unwrap_or(255);

                        // For Indexed colour spaces, expand the palette index
                        // (1 byte per pixel in stream) into a base-colour-
                        // space tuple before the existing RGBA conversion.
                        let comp_slice: &[u8] = if let Some(pal) = palette.as_ref() {
                            let pi = raw_pixels.get(i).copied().unwrap_or(0) as usize;
                            let p_off = pi * pal_chunk;
                            if p_off + pal_chunk <= pal.len() {
                                for j in 0..pal_chunk { pal_buf[j] = pal[p_off + j]; }
                            } else {
                                for j in 0..pal_chunk { pal_buf[j] = 0; }
                            }
                            i += stream_components as usize;
                            &pal_buf[..pal_chunk]
                        } else {
                            let s = &raw_pixels[i .. i + stream_components as usize];
                            i += stream_components as usize;
                            s
                        };

                        match components {
                            1 => {
                                let g = comp_slice[0];
                                let g2 = pm(g, alpha);
                                rgba.extend_from_slice(&[g2, g2, g2, alpha]);
                            }
                            3 => {
                                let r = comp_slice[0];
                                let g = comp_slice[1];
                                let b = comp_slice[2];
                                rgba.extend_from_slice(&[pm(r, alpha), pm(g, alpha), pm(b, alpha), alpha]);
                            }
                            4 => {
                                // CMYK → RGB (simple conversion)
                                let c = comp_slice[0] as f32 / 255.0;
                                let m = comp_slice[1] as f32 / 255.0;
                                let y = comp_slice[2] as f32 / 255.0;
                                let k = comp_slice[3] as f32 / 255.0;
                                let r = (255.0 * (1.0 - c) * (1.0 - k)) as u8;
                                let g = (255.0 * (1.0 - m) * (1.0 - k)) as u8;
                                let b = (255.0 * (1.0 - y) * (1.0 - k)) as u8;
                                rgba.extend_from_slice(&[pm(r, alpha), pm(g, alpha), pm(b, alpha), alpha]);
                            }
                            _ => {
                                rgba.extend_from_slice(&[0, 0, 0, alpha]);
                            }
                        }
                    }

                    // Send as raw RGBA with a simple header marker
                    // Format: "RGBA" magic (4 bytes) + width u16 LE + height u16 LE + RGBA pixels
                    let mut img_data = Vec::with_capacity(8 + rgba.len());
                    img_data.extend_from_slice(b"RGBA");
                    img_data.extend_from_slice(&width.to_le_bytes());
                    img_data.extend_from_slice(&height.to_le_bytes());
                    img_data.extend_from_slice(&rgba);

                    buf.save_state();
                    buf.transform(1.0, 0.0, 0.0, -1.0, 0.0, 1.0); // flip Y
                    buf.draw_image(width, height, &img_data);
                    buf.restore_state();
                }
            }
        }
    }

    /// Implements the `gs` operator: look up the named ExtGState in the
    /// current resources and apply its parameters to the current graphics
    /// state. Today only `/ca` (constant alpha for non-stroking ops) and
    /// `/CA` (constant alpha for stroking ops) are honoured — these are the
    /// transparency knobs that produce washed-out images and faded paths.
    fn apply_ext_gstate(
        operands: &[Object],
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
    ) {
        let name = match operands.first() {
            Some(Object::Name(n)) => n,
            _ => return,
        };
        let egs_obj = match resources.get(b"ExtGState") {
            Ok(o) => o,
            _ => return,
        };
        let egs_dict = match Self::resolve_dict(egs_obj, doc) {
            Ok(d) => d,
            _ => return,
        };
        let entry_obj = match egs_dict.get(name.as_slice()) {
            Ok(o) => o,
            _ => return,
        };
        let entry = match Self::resolve_dict(entry_obj, doc) {
            Ok(d) => d,
            _ => return,
        };
        if let Ok(v) = entry.get(b"ca") {
            state.current.fill_alpha = Self::f(v).clamp(0.0, 1.0);
        }
        if let Ok(v) = entry.get(b"CA") {
            state.current.stroke_alpha = Self::f(v).clamp(0.0, 1.0);
        }
    }

    fn resolve_dict<'a>(obj: &'a Object, doc: &'a Document) -> Result<&'a Dictionary, lopdf::Error> {
        match obj {
            Object::Dictionary(d) => Ok(d),
            Object::Reference(id) => {
                let resolved = doc.get_object(*id)?;
                resolved.as_dict()
            }
            _ => Err(lopdf::Error::Type),
        }
    }

    fn extract_form_resources(dict: &Dictionary, doc: &Document) -> Option<Dictionary> {
        let res_obj = dict.get(b"Resources").ok()?;
        match res_obj {
            Object::Reference(rid) => {
                doc.get_object(*rid).ok().and_then(|o| o.as_dict().ok().cloned())
            }
            Object::Dictionary(d) => Some(d.clone()),
            _ => None,
        }
    }

    /// Walk a content stream and emit one TextSpan per Tj/TJ run.
    /// Lighter than extract_commands — only the operators that affect text
    /// position or content are processed; path/color/image ops are skipped.
    pub fn extract_text_only(
        content_bytes: &[u8],
        spans: &mut Vec<crate::TextSpan>,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) -> Result<(), RenderError> {
        let content = Content::decode(content_bytes)
            .map_err(|e| RenderError::ParseError(format!("Content decode: {}", e)))?;

        let mut text_state = TextState::new();

        for op in &content.operations {
            match op.operator.as_str() {
                // Graphics state stack — only CTM matters for text positioning.
                "q" => state.save(),
                "Q" => state.restore(),
                "cm" => {
                    if op.operands.len() >= 6 {
                        state.concat_matrix(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                // Text state operators
                "BT" => text_state.begin_text(),
                "ET" => text_state.in_text = false,
                "Tf" => {
                    if op.operands.len() >= 2 {
                        if let Object::Name(ref name_bytes) = op.operands[0] {
                            text_state.current_font_name =
                                String::from_utf8_lossy(name_bytes).to_string();
                        }
                        text_state.font_size = Self::f(&op.operands[1]);
                    }
                }
                "TL" => {
                    if let Some(v) = op.operands.first() { text_state.leading = Self::f(v); }
                }
                "Td" => {
                    if op.operands.len() >= 2 {
                        text_state.translate_line(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
                    }
                }
                "TD" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.leading = -ty;
                        text_state.translate_line(tx, ty);
                    }
                }
                "Tm" => {
                    if op.operands.len() >= 6 {
                        text_state.set_text_matrix(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "T*" => text_state.translate_line(0.0, -text_state.leading),
                "Tc" => {
                    if let Some(v) = op.operands.first() { text_state.char_spacing = Self::f(v); }
                }
                "Tw" => {
                    if let Some(v) = op.operands.first() { text_state.word_spacing = Self::f(v); }
                }
                "Tz" => {
                    if let Some(v) = op.operands.first() { text_state.horizontal_scaling = Self::f(v) / 100.0; }
                }
                "Ts" => {
                    if let Some(v) = op.operands.first() { text_state.rise = Self::f(v); }
                }
                "Tj" => {
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            Self::emit_text_span(
                                bytes, &mut text_state, font_registry, doc, resources,
                                state, spans,
                            );
                        }
                    }
                }
                "TJ" => {
                    if let Some(Object::Array(arr)) = op.operands.first() {
                        for item in arr {
                            match item {
                                Object::String(bytes, _) => {
                                    if !bytes.is_empty() {
                                        Self::emit_text_span(
                                            bytes, &mut text_state, font_registry, doc, resources,
                                            state, spans,
                                        );
                                    }
                                }
                                Object::Integer(_) | Object::Real(_) => {
                                    text_state.apply_tj_kern(Self::f(item));
                                }
                                _ => {}
                            }
                        }
                    }
                }
                "'" => {
                    text_state.translate_line(0.0, -text_state.leading);
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            Self::emit_text_span(
                                bytes, &mut text_state, font_registry, doc, resources,
                                state, spans,
                            );
                        }
                    }
                }
                "\"" => {
                    if op.operands.len() >= 3 {
                        text_state.word_spacing = Self::f(&op.operands[0]);
                        text_state.char_spacing = Self::f(&op.operands[1]);
                        text_state.translate_line(0.0, -text_state.leading);
                        if let Object::String(bytes, _) = &op.operands[2] {
                            if !bytes.is_empty() {
                                Self::emit_text_span(
                                    bytes, &mut text_state, font_registry, doc, resources,
                                    state, spans,
                                );
                            }
                        }
                    }
                }
                // Form XObjects can contain nested text — recurse into them.
                "Do" => {
                    Self::handle_do_text_only(&op.operands, spans, state, doc, resources, font_registry);
                }
                _ => {} // skip path/color/image/everything else
            }
        }
        Ok(())
    }

    /// Helper: process one Tj/TJ string run and emit a TextSpan.
    /// Captures the start text-matrix, advances tm by each glyph's width,
    /// then computes the final user-space bbox by transforming through the
    /// current CTM. Decodes bytes to text via the font's ToUnicode CMap
    /// (falls back to Latin-1 / WinAnsi for fonts without ToUnicode).
    fn emit_text_span(
        bytes: &[u8],
        text_state: &mut TextState,
        font_registry: &mut crate::fonts::FontRegistry,
        doc: &Document,
        resources: &Dictionary,
        state: &GraphicsStateStack,
        spans: &mut Vec<crate::TextSpan>,
    ) {
        // Capture the start position in text space (BEFORE we advance tm).
        let start_tx = text_state.tm[4];
        let start_ty = text_state.tm[5];

        // Resolve font + decode text content. get_font returns Arc<FontEntry>;
        // we hold the Arc for the duration of this run so cache lookups are
        // a single refcount bump.
        let font_arc = font_registry.get_font(&text_state.current_font_name, doc, resources);
        let mut decoded = String::new();
        let mut total_advance_text_units: f32 = 0.0;

        if let Some(font_entry) = font_arc.as_deref() {
            if font_entry.is_cid {
                // Type0 / 2-byte CID font — process two bytes at a time.
                let mut i = 0;
                while i + 1 < bytes.len() {
                    let cid = u16::from_be_bytes([bytes[i], bytes[i + 1]]);
                    i += 2;
                    // ToUnicode for CID fonts is currently truncated to u8 in
                    // this codebase — best-effort decode for low CIDs.
                    if let Some(ch) = font_entry.to_unicode.get(&(cid as u8)) {
                        decoded.push(*ch);
                    } else {
                        decoded.push('\u{FFFD}');
                    }
                    let w0 = 0.5; // approximate em width — good enough for hit-testing
                    let tw = if cid == 32 || cid == 3 { text_state.word_spacing } else { 0.0 };
                    let tx = (w0 * text_state.font_size + text_state.char_spacing + tw) * text_state.horizontal_scaling;
                    total_advance_text_units += tx;
                    text_state.tm[4] += tx * text_state.tm[0];
                    text_state.tm[5] += tx * text_state.tm[1];
                }
            } else {
                // Single-byte font — decode each byte and advance precisely.
                let parsed_opt = font_entry.parsed.as_ref();
                for &byte in bytes {
                    let ch = if let Some(&c) = font_entry.to_unicode.get(&byte) {
                        c
                    } else {
                        crate::encoding::resolve_char_code(
                            font_entry.encoding_name.as_deref(),
                            &font_entry.differences,
                            byte,
                        )
                    };
                    decoded.push(ch);

                    let w0 = if let Some(parsed) = parsed_opt {
                        if let Some(gid) = crate::fonts::FontRegistry::char_to_glyph_id(font_entry, byte) {
                            if let Some(g) = parsed.glyphs.get(&gid) {
                                g.advance_width / parsed.units_per_em as f32
                            } else { 0.5 }
                        } else { 0.5 }
                    } else { 0.5 };
                    let tw = if byte == 32 { text_state.word_spacing } else { 0.0 };
                    let tx = (w0 * text_state.font_size + text_state.char_spacing + tw) * text_state.horizontal_scaling;
                    total_advance_text_units += tx;
                    text_state.tm[4] += tx * text_state.tm[0];
                    text_state.tm[5] += tx * text_state.tm[1];
                }
            }
        } else {
            // No font resolved — still advance the matrix so subsequent text
            // operators see a sensible position.
            for _ in bytes {
                let tx = 0.5 * text_state.font_size * text_state.horizontal_scaling;
                total_advance_text_units += tx;
                text_state.tm[4] += tx * text_state.tm[0];
                text_state.tm[5] += tx * text_state.tm[1];
            }
        }

        if decoded.is_empty() {
            return;
        }

        // Transform the start position from text space → user space via CTM.
        // Text space already has tm baked in; for the SPAN ORIGIN we apply CTM.
        let ctm = state.current.ctm;
        let user_x = start_tx * ctm.sx + start_ty * ctm.kx + ctm.tx;
        let user_y = start_tx * ctm.ky + start_ty * ctm.sy + ctm.ty;

        // Effective font size in user space ≈ Tfs × |CTM scale|.
        let ctm_scale = (ctm.sx * ctm.sx + ctm.ky * ctm.ky).sqrt().abs();
        let font_size_user = text_state.font_size * ctm_scale;

        // Width in user space: project the total text-space advance through
        // tm (text matrix) and CTM. The span advances along (tm[0], tm[1])
        // in text space, so the user-space delta is that vector × CTM.
        let dtx = total_advance_text_units * text_state.tm[0];
        let dty = total_advance_text_units * text_state.tm[1];
        let du_x = dtx * ctm.sx + dty * ctm.kx;
        let du_y = dtx * ctm.ky + dty * ctm.sy;
        let width_user = (du_x * du_x + du_y * du_y).sqrt();

        spans.push(crate::TextSpan {
            text: decoded,
            x: user_x,
            y: user_y,
            width: width_user,
            height: font_size_user,
            font_size: font_size_user,
        });
    }

    /// Recurse into a Form XObject for text-only extraction.
    fn handle_do_text_only(
        operands: &[Object],
        spans: &mut Vec<crate::TextSpan>,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) {
        let name = match operands.first() {
            Some(Object::Name(n)) => n,
            _ => return,
        };
        let xobj_dict = match resources.get(b"XObject").and_then(|o| Self::resolve_dict(o, doc)) {
            Ok(d) => d,
            _ => return,
        };
        let obj_ref = match xobj_dict.get(name.as_slice()) {
            Ok(o) => o,
            _ => return,
        };
        let resolved_id = match obj_ref {
            Object::Reference(id) => *id,
            _ => return,
        };
        let obj = match doc.get_object(resolved_id) {
            Ok(o) => o,
            _ => return,
        };
        let stream = match obj {
            Object::Stream(ref s) => s,
            _ => return,
        };
        let subtype = stream.dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok());
        if subtype != Some(b"Form" as &[u8]) {
            return;
        }
        state.save();
        if let Ok(matrix) = stream.dict.get(b"Matrix") {
            if let Ok(arr) = matrix.as_array() {
                if arr.len() >= 6 {
                    state.concat_matrix(
                        Self::f(&arr[0]), Self::f(&arr[1]),
                        Self::f(&arr[2]), Self::f(&arr[3]),
                        Self::f(&arr[4]), Self::f(&arr[5]),
                    );
                }
            }
        }
        let form_resources = Self::extract_form_resources(&stream.dict, doc);
        let res = form_resources.as_ref().unwrap_or(resources);
        if let Ok(content_bytes) = stream.decompressed_content() {
            let _ = Self::extract_text_only(&content_bytes, spans, state, doc, res, font_registry);
        }
        state.restore();
    }
}
