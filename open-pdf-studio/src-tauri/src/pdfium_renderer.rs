//! PDFium rendering integration for Open PDF Studio.
//!
//! Wraps the `pdfium-render` crate with the bindings we need for
//! `render_pdf_page` and `render_thumbnail` Tauri commands. Owns a
//! single static `Pdfium` instance for the lifetime of the app.
//!
//! Thread-safety: the `thread_safe` feature of `pdfium-render` wraps every
//! call in an internal mutex, so multiple Tauri command threads can
//! invoke PDFium concurrently — they just serialise inside PDFium.

use std::path::Path;
use std::sync::OnceLock;
use pdfium_render::prelude::*;

/// Global PDFium instance. Initialised once at app start by
/// `init_pdfium`. Subsequent calls to `pdfium()` are zero-cost lookups.
static PDFIUM: OnceLock<Pdfium> = OnceLock::new();

/// Initialise the PDFium runtime by dynamically loading the DLL at the
/// given directory. Call this exactly once during app startup, before
/// any Tauri command runs.
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
        // Safety: the document borrows from `bytes` and from `PDFIUM`. Both
        // live for 'static: `_bytes` is kept alive in the same struct, and
        // PDFIUM is a OnceLock<Pdfium> that is never dropped.
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

/// Get an Arc-wrapped PdfiumDocumentHandle for `path`. Reads bytes from
/// disk on cache miss. For the production hot path where bytes are already
/// cached, prefer `get_or_load_pdfium_doc_with_bytes`.
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
        .get(page_index as i32)
        .map_err(|e| format!("Page {} not found: {}", page_index, e))?;

    let width_pt = page.width().value;
    let height_pt = page.height().value;

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
        .rotate(rot, true)
        .render_form_data(true)
        .set_format(PdfBitmapFormat::BGRA);

    let bitmap = page
        .render_with_config(&config)
        .map_err(|e| format!("PDFium render failed: {}", e))?;

    let actual_w = bitmap.width() as u32;
    let actual_h = bitmap.height() as u32;
    let rgba = bitmap.as_rgba_bytes();

    Ok((actual_w, actual_h, rgba))
}

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
        .get(page_index as i32)
        .map_err(|e| format!("Page {}: {}", page_index, e))?;

    let w_pt = page.width().value;
    let h_pt = page.height().value;
    let scale = max_width as f32 / w_pt.max(h_pt);

    let (w, h, rgba) = render_page_to_rgba(doc, page_index, scale, rotation)?;

    // Convert RGBA -> RGB for JPEG (JPEG doesn't support alpha).
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for chunk in rgba.chunks(4) {
        rgb.push(chunk[0]);
        rgb.push(chunk[1]);
        rgb.push(chunk[2]);
    }

    let mut jpeg_bytes = Vec::with_capacity(rgb.len() / 4);
    {
        use image::codecs::jpeg::JpegEncoder;
        use image::ImageEncoder;
        let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 75);
        encoder
            .write_image(&rgb, w, h, image::ExtendedColorType::Rgb8)
            .map_err(|e| format!("JPEG encode: {}", e))?;
    }

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}
