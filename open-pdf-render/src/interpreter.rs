use lopdf::content::Content;
use lopdf::Object;
use crate::graphics_state::GraphicsStateStack;
use crate::renderer::SkiaRenderer;
use crate::draw_commands::DrawCommandBuffer;
use crate::color;
use crate::RenderError;

pub struct Interpreter;

impl Interpreter {
    pub fn execute(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
    ) -> Result<(), RenderError> {
        let content = Content::decode(content_bytes)
            .map_err(|e| RenderError::ParseError(format!("Content decode: {}", e)))?;

        let mut has_active_path = false;

        for op in &content.operations {
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
                // Clipping, text, XObjects -- skip for now
                "W" | "W*" => {}
                "BT" | "ET" | "Tf" | "Td" | "TD" | "Tm" | "Tj" | "TJ" | "T*" | "'" | "\"" | "Tc" | "Tw" | "Tz" | "TL" | "Ts" | "Tr" => {}
                "Do" => {}
                "gs" | "ri" | "i" => {}
                _ => {}
            }
        }
        Ok(())
    }

    pub fn extract_commands(
        content_bytes: &[u8],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
    ) -> Result<(), RenderError> {
        let content = Content::decode(content_bytes)
            .map_err(|e| RenderError::ParseError(format!("Content decode: {}", e)))?;

        let mut has_active_path = false;

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
                // Clipping, text, XObjects -- skip
                "W" | "W*" => {}
                "BT" | "ET" | "Tf" | "Td" | "TD" | "Tm" | "Tj" | "TJ" | "T*" | "'" | "\"" | "Tc" | "Tw" | "Tz" | "TL" | "Ts" | "Tr" => {}
                "Do" => {}
                "gs" | "ri" | "i" => {}
                _ => {}
            }
        }
        Ok(())
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
}
