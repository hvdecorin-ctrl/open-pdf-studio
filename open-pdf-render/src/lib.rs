mod parser;
mod graphics_state;
mod interpreter;
mod renderer;
mod color;
mod image_decode;
pub mod draw_commands;
pub mod encoding;
pub mod font_parser;
pub mod fonts;
pub mod text_renderer;

pub use parser::DocumentHandle;
pub use draw_commands::DrawCommandBuffer;

#[derive(Debug, PartialEq)]
pub enum PageType {
    Vector,
    Tile,
}

#[derive(Debug)]
pub enum RenderError {
    ParseError(String),
    UnsupportedFeature(String),
    RenderError(String),
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderError::ParseError(s) => write!(f, "Parse error: {}", s),
            RenderError::UnsupportedFeature(s) => write!(f, "Unsupported: {}", s),
            RenderError::RenderError(s) => write!(f, "Render error: {}", s),
        }
    }
}

pub struct RenderedPage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// One run of text extracted from a page's content stream. Coordinates are
/// in PDF user space (Y-up, MediaBox-relative). The JS side flips Y and
/// applies the viewport transform to position selectable text spans on top
/// of the rendered page.
///
/// Used to build the text-selection layer without re-parsing the page via
/// PDF.js — the Rust interpreter already walks every text operator when it
/// builds draw commands, so emitting text spans during the same walk is
/// essentially free.
#[derive(Debug, Clone)]
pub struct TextSpan {
    /// Decoded UTF-8 text content of this run.
    pub text: String,
    /// Origin x in PDF user space (after CTM, before Y-flip).
    pub x: f32,
    /// Origin y in PDF user space (after CTM, before Y-flip).
    /// This is the BASELINE of the text, not the top.
    pub y: f32,
    /// Width of the run in user-space units (cumulative glyph advance).
    pub width: f32,
    /// Height of the run in user-space units (≈ font size in user space).
    pub height: f32,
    /// Effective font size in user-space units (after CTM scale).
    pub font_size: f32,
}

pub struct PdfRenderer;

impl PdfRenderer {
    pub fn new() -> Self {
        PdfRenderer
    }

    pub fn load_document(&self, bytes: &[u8]) -> Result<DocumentHandle, RenderError> {
        DocumentHandle::load(bytes)
    }
}
