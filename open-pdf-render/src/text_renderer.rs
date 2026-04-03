use crate::font_parser::OutlineCommand;
use crate::fonts::{FontEntry, FontRegistry};
use crate::draw_commands::DrawCommandBuffer;

/// Render a text string as vector glyph outlines.
/// `font_size`: the raw Tf size (NOT multiplied by text matrix)
/// `tm`: the full text matrix [a, b, c, d, e, f]
/// `tx`, `ty`: accumulated text position offsets
/// Glyph outlines are in font units (Y-up). PDF space has Y-up too (before viewport Y-flip).
pub fn render_text_glyphs(
    text_bytes: &[u8],
    font_entry: &FontEntry,
    font_size: f32,
    tm: &[f32; 6],
    tx: f32,
    ty: f32,
    fill_rgba: u32,
    buf: &mut DrawCommandBuffer,
) -> f32 {
    let parsed = match &font_entry.parsed {
        Some(p) => p,
        None => return 0.0,
    };

    // Scale from font units to PDF user space
    let glyph_scale = font_size / parsed.units_per_em as f32;

    // Text rendering matrix = Tm × [fontSize 0 0 fontSize 0 0]
    // But we apply Tm as a full transform and scale glyphs by fontSize/unitsPerEm
    let text_x = tm[4] + tx;
    let text_y = tm[5] + ty;

    let mut cursor_x = 0.0f32; // in PDF user space units

    for &byte in text_bytes {
        let glyph_id = match FontRegistry::char_to_glyph_id(font_entry, byte) {
            Some(id) => id,
            None => continue,
        };
        if let Some(outline) = parsed.glyphs.get(&glyph_id) {
            if !outline.commands.is_empty() {
                buf.save_state();
                // Position: translate to text position + cursor advance
                // Then apply text matrix rotation/scale (tm[0..3])
                // Then scale glyph from font units to PDF units
                let gx = text_x + cursor_x * tm[0];
                let gy = text_y + cursor_x * tm[1];
                buf.transform(
                    tm[0] * glyph_scale, tm[1] * glyph_scale,
                    tm[2] * glyph_scale, tm[3] * glyph_scale,
                    gx, gy,
                );

                buf.begin_path();
                for cmd in &outline.commands {
                    match cmd {
                        OutlineCommand::MoveTo(x, y) => buf.move_to(*x, *y),
                        OutlineCommand::LineTo(x, y) => buf.line_to(*x, *y),
                        OutlineCommand::CubicTo(x1, y1, x2, y2, x, y) => {
                            buf.cubic_to(*x1, *y1, *x2, *y2, *x, *y)
                        }
                        OutlineCommand::Close => buf.close_path(),
                    }
                }
                buf.set_fill(fill_rgba);
                buf.fill();
                buf.restore_state();
            }
            cursor_x += outline.advance_width * glyph_scale;
        }
    }
    cursor_x
}
