// Profile per-page render time. Run:
//   cargo run --release --example profile_render -- <pdf>
//
// Reports load+parse time once, then per-page page_dimensions + render_page
// elapsed times. Renders are done with literal-width scale = 2000.0/w_pt to
// approximate the regression-test corpus output sizes.

use std::time::Instant;

fn main() {
    let path = std::env::args().nth(1).expect("usage: profile_render <pdf>");
    let pdf_bytes = std::fs::read(&path).expect("read pdf");

    let t_load = Instant::now();
    let doc = open_pdf_render::DocumentHandle::load(&pdf_bytes).expect("load pdf");
    let load_ms = t_load.elapsed().as_millis();
    let pages = doc.page_count();
    println!("Load+parse:   {:>6} ms  ({} pages)", load_ms, pages);

    let n = pages.min(8);
    let mut total_render = 0u128;
    for i in 0..n {
        let t_dim = Instant::now();
        let (w_pt, _h_pt) = doc.page_dimensions(i).unwrap();
        let dim_us = t_dim.elapsed().as_micros();

        let scale = 2000.0 / w_pt;
        let t_render = Instant::now();
        let r = doc.render_page(i, scale, 0).expect("render");
        let render_ms = t_render.elapsed().as_millis();
        total_render += render_ms;
        println!(
            "  p{} render: {:>6} ms  (dim {:>4} us, out {}x{})",
            i, render_ms, dim_us, r.width, r.height
        );
    }
    println!("Total render: {:>6} ms over {} pages", total_render, n);
}
