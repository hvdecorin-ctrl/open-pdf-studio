use std::sync::Mutex;
use lopdf::ObjectId;
use crate::{RenderError, RenderedPage};
use crate::fonts::FontRegistry;

pub struct DocumentHandle {
    doc: lopdf::Document,
    /// Document-scoped font cache. Lives for the lifetime of the
    /// DocumentHandle so glyph outlines for fonts shared across pages are
    /// only extracted once. Uses Mutex for Send+Sync (Tauri commands run on
    /// a thread pool); contention is rare in practice.
    font_registry: Mutex<FontRegistry>,
}

impl DocumentHandle {
    pub fn load(bytes: &[u8]) -> Result<Self, RenderError> {
        let doc = lopdf::Document::load_from(std::io::Cursor::new(bytes))
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        Ok(DocumentHandle {
            doc,
            font_registry: Mutex::new(FontRegistry::new()),
        })
    }

    pub fn page_count(&self) -> usize {
        self.doc.get_pages().len()
    }

    /// Returns the displayed dimensions of a page, accounting for the
    /// page's `/Rotate` field. For 90/270 rotations the width and height
    /// are swapped relative to the un-rotated MediaBox.
    pub fn page_dimensions(&self, page: usize) -> Result<(f32, f32), RenderError> {
        let page_id = self.get_page_id(page)?;
        let (w, h) = self.extract_media_box(page_id)?;
        let pdf_rot = self.read_page_rotation(page_id);
        Ok(Self::rotated_dimensions(pdf_rot, w, h))
    }

    /// Render a page to an RGBA bitmap, applying the combined rotation of
    /// the PDF's `/Rotate` field plus an optional `extra_rotation` from the
    /// app (e.g. user-applied rotation via the rotate-left/right buttons).
    /// Both rotations are clockwise-when-displayed, in degrees.
    pub fn render_page(&self, page: usize, scale: f32, extra_rotation: i32) -> Result<RenderedPage, RenderError> {
        self.render_page_internal(page, scale, extra_rotation, false)
    }

    /// Render a page without decoding embedded images. Produces vector-only
    /// output suitable for thumbnails — runs in milliseconds instead of
    /// seconds for image-heavy pages.
    pub fn render_page_no_images(&self, page: usize, scale: f32, extra_rotation: i32) -> Result<RenderedPage, RenderError> {
        self.render_page_internal(page, scale, extra_rotation, true)
    }

    fn render_page_internal(&self, page: usize, scale: f32, extra_rotation: i32, skip_images: bool) -> Result<RenderedPage, RenderError> {
        let page_id = self.get_page_id(page)?;
        let (x0, y0, w_pt, h_pt) = self.extract_media_box_full(page_id)?;

        let pdf_rot = self.read_page_rotation(page_id);
        let total_rot = ((pdf_rot + extra_rotation) % 360 + 360) % 360;

        // Post-rotation pixel dimensions
        let (out_w_pt, out_h_pt) = Self::rotated_dimensions(total_rot, w_pt, h_pt);
        let width = (out_w_pt * scale).ceil() as u32;
        let height = (out_h_pt * scale).ceil() as u32;

        let mut renderer = crate::renderer::SkiaRenderer::new(width, height)
            .map_err(|e| RenderError::RenderError(e))?;

        let mut state = crate::graphics_state::GraphicsStateStack::new();

        // Page-to-pixel transform built using the POST-rotation dimensions.
        // The rotation matrix below is then pre-concatenated so it runs
        // FIRST in user-space, before this transform.
        state.current.ctm = tiny_skia::Transform::from_row(
            scale, 0.0, 0.0, -scale,
            0.0, out_h_pt * scale,
        );

        // Apply the rotation, OR fall back to the un-rotated MediaBox-origin
        // shift if no rotation is needed (preserves the existing behaviour
        // for AutoCAD-style PDFs with negative-origin MediaBoxes).
        if let Some(rot_xform) = Self::rotation_transform(total_rot, (x0, y0, x0 + w_pt, y0 + h_pt)) {
            state.current.ctm = state.current.ctm.pre_concat(rot_xform);
        } else {
            // No rotation — keep the original MediaBox-origin shift
            let shift = tiny_skia::Transform::from_row(1.0, 0.0, 0.0, 1.0, -x0, -y0);
            state.current.ctm = state.current.ctm.pre_concat(shift);
        }

        let content_bytes = self.get_content_stream(page_id)?;
        let resources = self.get_page_resources(page_id)?;
        if skip_images {
            crate::interpreter::Interpreter::execute_skip_images(&content_bytes, &mut renderer, &mut state, &self.doc, &resources)?;
        } else {
            crate::interpreter::Interpreter::execute(&content_bytes, &mut renderer, &mut state, &self.doc, &resources)?;
        }

        Ok(RenderedPage { width, height, rgba: renderer.into_rgba() })
    }

    fn get_page_id(&self, page: usize) -> Result<ObjectId, RenderError> {
        let pages = self.doc.get_pages();
        let mut sorted: Vec<_> = pages.iter().collect();
        sorted.sort_by_key(|(num, _)| *num);
        let (_, &page_id) = sorted.get(page)
            .ok_or_else(|| RenderError::ParseError(format!("Page {} not found", page)))?;
        Ok(page_id)
    }

    // Returns (x0, y0, width, height) — origin can be non-zero!
    fn extract_media_box_full(&self, page_id: ObjectId) -> Result<(f32, f32, f32, f32), RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page is not a dict".into()))?;

        // Use CropBox if available, otherwise MediaBox
        let box_arr = dict.get(b"CropBox")
            .or_else(|_| dict.get(b"MediaBox"))
            .map_err(|_| RenderError::ParseError("No MediaBox/CropBox".into()))?
            .as_array()
            .map_err(|_| RenderError::ParseError("Box not array".into()))?;

        let x0 = Self::obj_to_f32(&box_arr[0])?;
        let y0 = Self::obj_to_f32(&box_arr[1])?;
        let x1 = Self::obj_to_f32(&box_arr[2])?;
        let y1 = Self::obj_to_f32(&box_arr[3])?;
        Ok((x0, y0, (x1 - x0).abs(), (y1 - y0).abs()))
    }

    fn extract_media_box(&self, page_id: ObjectId) -> Result<(f32, f32), RenderError> {
        let (_, _, w, h) = self.extract_media_box_full(page_id)?;
        Ok((w, h))
    }

    fn get_page_resources(&self, page_id: ObjectId) -> Result<lopdf::Dictionary, RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page is not a dict".into()))?;

        match dict.get(b"Resources") {
            Ok(res) => {
                match res {
                    lopdf::Object::Dictionary(d) => Ok(d.clone()),
                    lopdf::Object::Reference(id) => {
                        let resolved = self.doc.get_object(*id)
                            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
                        resolved.as_dict()
                            .map(|d| d.clone())
                            .map_err(|_| RenderError::ParseError("Resources is not a dict".into()))
                    }
                    _ => Ok(lopdf::Dictionary::new()),
                }
            }
            Err(_) => Ok(lopdf::Dictionary::new()),
        }
    }

    fn get_content_stream(&self, page_id: ObjectId) -> Result<Vec<u8>, RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page is not a dict".into()))?;

        let contents = match dict.get(b"Contents") {
            Ok(c) => c,
            Err(_) => return Ok(Vec::new()),
        };

        match contents {
            lopdf::Object::Reference(id) => {
                self.decode_stream(*id)
            }
            lopdf::Object::Array(arr) => {
                let mut all_bytes = Vec::new();
                for item in arr {
                    match item {
                        lopdf::Object::Reference(id) => {
                            let bytes = self.decode_stream(*id)?;
                            all_bytes.extend_from_slice(&bytes);
                            all_bytes.push(b'\n');
                        }
                        _ => {}
                    }
                }
                Ok(all_bytes)
            }
            lopdf::Object::Stream(stream) => {
                stream.decompressed_content()
                    .map_err(|e| RenderError::ParseError(format!("Decompress: {}", e)))
            }
            _ => Ok(Vec::new()),
        }
    }

    fn decode_stream(&self, id: ObjectId) -> Result<Vec<u8>, RenderError> {
        let obj = self.doc.get_object(id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        match obj {
            lopdf::Object::Stream(stream) => {
                stream.decompressed_content()
                    .map_err(|e| RenderError::ParseError(format!("Decompress: {}", e)))
            }
            _ => Err(RenderError::ParseError("Contents ref is not a stream".into())),
        }
    }

    fn obj_to_f32(obj: &lopdf::Object) -> Result<f32, RenderError> {
        match obj {
            lopdf::Object::Real(r) => Ok(*r as f32),
            lopdf::Object::Integer(i) => Ok(*i as f32),
            _ => Err(RenderError::ParseError("Expected number".into())),
        }
    }

    /// Read the page's `/Rotate` value, walking the `/Parent` chain if the
    /// entry isn't on the page object itself (PDF spec: /Rotate is
    /// inheritable through the page tree). Returns degrees normalized to
    /// {0, 90, 180, 270}.
    pub fn read_page_rotation(&self, page_id: ObjectId) -> i32 {
        let page_obj = match self.doc.get_object(page_id) {
            Ok(o) => o,
            Err(_) => return 0,
        };
        let dict = match page_obj.as_dict() {
            Ok(d) => d,
            Err(_) => return 0,
        };

        // Check this dict, then walk /Parent if missing.
        let mut current = dict.clone();
        for _ in 0..10 {
            if let Ok(rot) = current.get(b"Rotate") {
                let raw = match rot {
                    lopdf::Object::Integer(i) => *i as i32,
                    lopdf::Object::Real(r) => *r as i32,
                    lopdf::Object::Reference(id) => {
                        if let Ok(o) = self.doc.get_object(*id) {
                            match o {
                                lopdf::Object::Integer(i) => *i as i32,
                                lopdf::Object::Real(r) => *r as i32,
                                _ => 0,
                            }
                        } else { 0 }
                    }
                    _ => 0,
                };
                return ((raw % 360) + 360) % 360;
            }
            // Walk to parent
            let parent = match current.get(b"Parent") {
                Ok(lopdf::Object::Reference(id)) => self.doc.get_object(*id),
                _ => break,
            };
            let parent_obj = match parent { Ok(p) => p, Err(_) => break };
            let parent_dict = match parent_obj.as_dict() { Ok(d) => d, Err(_) => break };
            current = parent_dict.clone();
        }
        0
    }

    /// Build the transformation matrix that rotates a page's content by the
    /// given number of degrees (clockwise when displayed) AND maps it into
    /// positive coordinates starting at (0, 0). The result is a Y-up
    /// (PDF user-space) transform that pre-concats onto the page CTM.
    ///
    /// For 0° → identity. For 90/180/270 → rotation + translation so the
    /// rotated page bounding box has its bottom-left at (0, 0).
    ///
    /// `mb` is the original (un-rotated) MediaBox: (x0, y0, x1, y1).
    fn rotation_transform(rotation_deg: i32, mb: (f32, f32, f32, f32)) -> Option<tiny_skia::Transform> {
        let (x0, y0, x1, y1) = mb;
        match ((rotation_deg % 360) + 360) % 360 {
            0 => None,
            90 => {
                // (x, y) → (y - y0, x1 - x)
                Some(tiny_skia::Transform::from_row(0.0, -1.0, 1.0, 0.0, -y0, x1))
            }
            180 => {
                // (x, y) → (x1 - x, y1 - y)
                Some(tiny_skia::Transform::from_row(-1.0, 0.0, 0.0, -1.0, x1, y1))
            }
            270 => {
                // (x, y) → (y1 - y, x - x0)
                Some(tiny_skia::Transform::from_row(0.0, 1.0, -1.0, 0.0, y1, -x0))
            }
            _ => None, // non-multiple of 90 — ignore
        }
    }

    /// Returns the post-rotation page dimensions: for 0/180 the original
    /// (W, H); for 90/270 the swapped (H, W).
    fn rotated_dimensions(rotation_deg: i32, w: f32, h: f32) -> (f32, f32) {
        match ((rotation_deg % 360) + 360) % 360 {
            90 | 270 => (h, w),
            _ => (w, h),
        }
    }

    /// Analyze whether a page is pure vector or contains raster content (images/shading)
    pub fn analyze_page_type(&self, page: usize) -> Result<crate::PageType, RenderError> {
        let page_id = self.get_page_id(page)?;
        let content_bytes = self.get_content_stream(page_id)?;
        let content = lopdf::content::Content::decode(&content_bytes)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;

        let mut has_raster_images = false;
        for op in &content.operations {
            match op.operator.as_str() {
                // Only classify as Tile if there are shading patterns
                // Do (XObjects) can be Form XObjects (vector) — we try vector mode first
                "sh" => has_raster_images = true,
                _ => {}
            }
        }
        if has_raster_images {
            Ok(crate::PageType::Tile)
        } else {
            Ok(crate::PageType::Vector)
        }
    }

    /// Extract draw commands without rendering to bitmap.
    /// Returns binary buffer with 16-byte header (f32 LE: x0, y0, pageW, pageH) + commands.
    /// x0/y0 is the MediaBox origin — can be non-zero (e.g. -846, -595).
    ///
    /// Borrows the document-scoped FontRegistry so glyph outline extraction
    /// for fonts seen on previous pages is reused. The first page that uses
    /// a given font pays the parse cost; subsequent pages are ~free for that
    /// font's text.
    pub fn extract_draw_commands(&self, page: usize, extra_rotation: i32) -> Result<crate::DrawCommandBuffer, RenderError> {
        let page_id = self.get_page_id(page)?;
        let (x0, y0, w_pt, h_pt) = self.extract_media_box_full(page_id)?;
        let content_bytes = self.get_content_stream(page_id)?;

        let pdf_rot = self.read_page_rotation(page_id);
        let total_rot = ((pdf_rot + extra_rotation) % 360 + 360) % 360;

        // Compute the post-rotation dimensions and origin to write into the
        // header. For a rotated page the rotation matrix already maps the
        // original content to start at (0, 0), so we report origin (0, 0).
        // For an un-rotated page we keep the original MediaBox-origin
        // semantics so PDFs with negative origins still work the same way.
        let (out_x0, out_y0, out_w, out_h) = if total_rot == 0 {
            (x0, y0, w_pt, h_pt)
        } else {
            let (rw, rh) = Self::rotated_dimensions(total_rot, w_pt, h_pt);
            (0.0_f32, 0.0_f32, rw, rh)
        };

        let mut state = crate::graphics_state::GraphicsStateStack::new();

        // For rotated pages, seed the GraphicsStateStack's CTM with the
        // rotation matrix so every operator that follows is implicitly
        // applied AFTER the rotation. This produces draw commands in the
        // post-rotation coordinate system.
        if let Some(rot_xform) = Self::rotation_transform(total_rot, (x0, y0, x0 + w_pt, y0 + h_pt)) {
            state.current.ctm = rot_xform;
        }

        let mut cmds = crate::draw_commands::DrawCommandBuffer::new();

        // For rotated pages, also emit the rotation as the very first
        // Transform command in the buffer so the JS replay sees it. The
        // GraphicsStateStack rotation above is for the interpreter's bbox
        // tracking; the buffer's transform command is what JS actually
        // executes when it replays the commands onto canvas.
        if let Some(rot_xform) = Self::rotation_transform(total_rot, (x0, y0, x0 + w_pt, y0 + h_pt)) {
            cmds.transform(rot_xform.sx, rot_xform.ky, rot_xform.kx, rot_xform.sy, rot_xform.tx, rot_xform.ty);
        }

        let resources = self.get_page_resources(page_id)?;

        let mut font_registry = self.font_registry.lock()
            .map_err(|e| RenderError::RenderError(format!("Font registry poisoned: {}", e)))?;
        crate::interpreter::Interpreter::extract_commands(
            &content_bytes, &mut cmds, &mut state, &self.doc, &resources, &mut *font_registry,
        )?;
        drop(font_registry);

        // Prepend 16-byte header: x0, y0, width, height (all f32 LE)
        let cmd_bytes = cmds.into_bytes();
        let mut result = Vec::with_capacity(16 + cmd_bytes.len());
        result.extend_from_slice(&out_x0.to_le_bytes());
        result.extend_from_slice(&out_y0.to_le_bytes());
        result.extend_from_slice(&out_w.to_le_bytes());
        result.extend_from_slice(&out_h.to_le_bytes());
        result.extend(cmd_bytes);

        Ok(crate::DrawCommandBuffer::from_vec(result))
    }

    /// Extract text spans from a page WITHOUT producing draw commands.
    ///
    /// Walks the same content stream as extract_draw_commands but only emits
    /// `TextSpan { text, x, y, width, height, font_size }` for every Tj/TJ
    /// run. Replaces the second PDF parse the JS layer used to do via
    /// PDF.js's getTextContent — this runs ~10x faster because it shares
    /// the document-scoped font registry and doesn't build glyph outlines.
    ///
    /// Use this to populate a text-selection layer over the rendered page.
    pub fn extract_text_spans(&self, page: usize) -> Result<Vec<crate::TextSpan>, RenderError> {
        let page_id = self.get_page_id(page)?;
        let content_bytes = self.get_content_stream(page_id)?;
        let resources = self.get_page_resources(page_id)?;

        let mut state = crate::graphics_state::GraphicsStateStack::new();
        let mut spans = Vec::new();

        let mut font_registry = self.font_registry.lock()
            .map_err(|e| RenderError::RenderError(format!("Font registry poisoned: {}", e)))?;
        crate::interpreter::Interpreter::extract_text_only(
            &content_bytes, &mut spans, &mut state, &self.doc, &resources, &mut *font_registry,
        )?;
        Ok(spans)
    }

    /// Extract text span positions from a page.
    /// Returns a JSON array string of text spans with x, y, width, height, fontSize, and text.
    /// Coordinates are in PDF user space (origin bottom-left, Y up).
    pub fn extract_text_positions(&self, page: usize) -> Result<String, RenderError> {
        let page_id = self.get_page_id(page)?;
        let (_x0, _y0, _w_pt, _h_pt) = self.extract_media_box_full(page_id)?;
        let content_bytes = self.get_content_stream(page_id)?;
        let resources = self.get_page_resources(page_id)?;

        let mut state = crate::graphics_state::GraphicsStateStack::new();
        let mut cmds = crate::draw_commands::DrawCommandBuffer::new();
        let mut font_registry = self.font_registry.lock()
            .map_err(|e| RenderError::RenderError(format!("Font registry poisoned: {}", e)))?;
        let mut text_spans = Vec::new();

        crate::interpreter::Interpreter::extract_commands_with_text(
            &content_bytes, &mut cmds, &mut state, &self.doc, &resources,
            &mut *font_registry, Some(&mut text_spans),
        )?;

        let json_spans: Vec<String> = text_spans.iter().map(|s| s.to_json()).collect();
        Ok(format!("[{}]", json_spans.join(",")))
    }

    /// Extract text spans for many pages in parallel using rayon.
    /// The font registry mutex serializes the font *parsing* work but the
    /// content-stream walks for different pages can run in parallel.
    pub fn extract_text_spans_batch(&self, pages: &[usize]) -> Vec<Result<Vec<crate::TextSpan>, RenderError>> {
        use rayon::prelude::*;
        pages.par_iter().map(|&p| self.extract_text_spans(p)).collect()
    }

    /// Extract draw commands for many pages in parallel using rayon.
    /// Used for adjacent-page prefetch and bulk warm-up. Returns one result
    /// per requested page in the same order. Each (page, extra_rotation)
    /// pair is independent so different pages can have different user rotation.
    pub fn extract_draw_commands_batch(&self, pages: &[(usize, i32)]) -> Vec<Result<crate::DrawCommandBuffer, RenderError>> {
        use rayon::prelude::*;
        pages.par_iter().map(|&(p, rot)| self.extract_draw_commands(p, rot)).collect()
    }

    /// Extract dimensions for ALL pages in parallel. Faster than the
    /// sequential `(0..page_count()).map(page_dimensions)` loop on
    /// multi-page documents because page-dimension extraction reads the
    /// page object tree which is cheap and embarrassingly parallel.
    pub fn page_dimensions_all(&self) -> Vec<Result<(f32, f32), RenderError>> {
        use rayon::prelude::*;
        (0..self.page_count())
            .into_par_iter()
            .map(|i| self.page_dimensions(i))
            .collect()
    }
}
