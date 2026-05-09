// One-shot diagnostic: render a single PDF page using LITERAL-width scale
// (i.e. `scale = width / page_w_pt`, matching the PyMuPDF reference renderer)
// and write to PNG. Used to verify whether the regression-test scale-mismatch
// alone accounts for the rendered-vs-reference diff %.
//
// Usage: cargo run --release --example render_page_literal -- <pdf> <page_index> <width> <out.png>

use image::{ImageBuffer, Rgba};
use std::env;
use std::path::Path;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 5 {
        eprintln!("usage: render_page_literal <pdf> <page_index> <width> <out.png>");
        std::process::exit(2);
    }
    let pdf_path = &args[1];
    let page_index: usize = args[2].parse().expect("page_index must be uint");
    let width: u32 = args[3].parse().expect("width must be uint");
    let out_path = &args[4];

    let bytes = std::fs::read(pdf_path).expect("read pdf");
    let doc = open_pdf_render::DocumentHandle::load(&bytes).expect("load pdf");
    let (w_pt, h_pt) = doc
        .page_dimensions(page_index)
        .expect("page_dimensions");
    let scale = width as f32 / w_pt;
    eprintln!(
        "page {}: {}x{} pt, scale={:.5}, expected output {}x{}",
        page_index,
        w_pt,
        h_pt,
        scale,
        (w_pt * scale).ceil() as u32,
        (h_pt * scale).ceil() as u32
    );
    let rendered = doc.render_page(page_index, scale, 0).expect("render");
    eprintln!("actual output: {}x{}", rendered.width, rendered.height);

    let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_vec(
        rendered.width,
        rendered.height,
        rendered.rgba,
    )
    .expect("buffer size mismatch");
    img.save(Path::new(out_path)).expect("save png");
    eprintln!("wrote {}", out_path);
}
