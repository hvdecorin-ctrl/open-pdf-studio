// Quick diagnostic: read a PDF and print MediaBox / CropBox / Rotate for
// each page, plus the actual bounding box of all drawn content INCLUDING
// content inside Form XObjects (Do operator), recursively.
// Usage: cargo run --example inspect_page -- "path/to/file.pdf"

use lopdf::{Dictionary, Document, Object, content::Content};
use std::collections::HashMap;
use std::env;

fn main() {
    let path = env::args().nth(1).expect("usage: inspect_page <pdf>");
    let doc = Document::load(&path).expect("failed to load pdf");

    let pages = doc.get_pages();
    let mut sorted: Vec<_> = pages.iter().collect();
    sorted.sort_by_key(|(num, _)| *num);

    for (i, (num, page_id)) in sorted.iter().enumerate() {
        println!("\n=== page index {} (PDF page #{}) — object {:?} ===", i, num, page_id);
        let page_obj = match doc.get_object(**page_id) {
            Ok(o) => o,
            Err(e) => { println!("  get_object error: {}", e); continue; }
        };
        let dict = match page_obj.as_dict() {
            Ok(d) => d,
            Err(e) => { println!("  as_dict error: {}", e); continue; }
        };

        // Print every box-like field, with inheritance from parent
        for box_name in &["MediaBox", "CropBox", "BleedBox", "TrimBox", "ArtBox"] {
            let val = lookup_with_inheritance(&doc, dict, box_name.as_bytes());
            if let Some(v) = val {
                println!("  {}: {:?}", box_name, format_box(&v));
            } else {
                println!("  {}: <missing>", box_name);
            }
        }

        // Rotate
        let rotate = lookup_with_inheritance(&doc, dict, b"Rotate");
        match rotate {
            Some(Object::Integer(i)) => println!("  Rotate: {}", i),
            Some(Object::Real(r)) => println!("  Rotate: {} (float)", r),
            Some(o) => println!("  Rotate: {:?}", o),
            None => println!("  Rotate: <missing> (default 0)"),
        }

        // UserUnit
        match dict.get(b"UserUnit") {
            Ok(Object::Real(r)) => println!("  UserUnit: {}", r),
            Ok(Object::Integer(i)) => println!("  UserUnit: {}", i),
            _ => {}
        }

        // Walk the content stream INCLUDING form XObjects recursively.
        let resources = get_page_resources(&doc, dict);
        if let Some(content_bytes) = get_content_stream(&doc, dict) {
            let mut walker = BboxWalker::new(&doc);
            walker.walk(&content_bytes, resources.as_ref(), 0);
            match walker.bbox() {
                Some(bbox) => {
                    println!("  Content bbox (incl. forms): [{:.2}, {:.2}, {:.2}, {:.2}]  (w={:.2}, h={:.2})",
                             bbox.min_x, bbox.min_y, bbox.max_x, bbox.max_y,
                             bbox.max_x - bbox.min_x, bbox.max_y - bbox.min_y);
                    println!("  Operator counts: {:?}", walker.op_counts);
                    println!("  Form XObjects entered: {}", walker.forms_entered);

                    if let Some(mb) = lookup_with_inheritance(&doc, dict, b"MediaBox") {
                        if let Object::Array(arr) = mb {
                            if arr.len() == 4 {
                                let mx0 = obj_to_f32(&arr[0]);
                                let my0 = obj_to_f32(&arr[1]);
                                let mx1 = obj_to_f32(&arr[2]);
                                let my1 = obj_to_f32(&arr[3]);
                                let dl = mx0 - bbox.min_x;
                                let dr = bbox.max_x - mx1;
                                let dt = bbox.max_y - my1;
                                let db = my0 - bbox.min_y;
                                println!("  Overflow vs MediaBox: left={:.2} right={:.2} top={:.2} bottom={:.2}",
                                         dl.max(0.0), dr.max(0.0), dt.max(0.0), db.max(0.0));
                                if dr > 0.5 || dl > 0.5 || dt > 0.5 || db > 0.5 {
                                    println!("  ⚠️  CONTENT EXTENDS BEYOND MEDIABOX");
                                }
                            }
                        }
                    }
                }
                None => println!("  Content bbox: <empty / no draw operators>"),
            }
        } else {
            println!("  Content bbox: <no content stream>");
        }

        if i >= 5 { break; } // first 6 pages only
    }
    println!("\nTotal pages: {}", sorted.len());
}

fn obj_to_f32(o: &Object) -> f32 {
    match o {
        Object::Real(r) => *r as f32,
        Object::Integer(i) => *i as f32,
        _ => 0.0,
    }
}

fn get_content_stream(doc: &Document, page_dict: &lopdf::Dictionary) -> Option<Vec<u8>> {
    let contents = page_dict.get(b"Contents").ok()?;
    match contents {
        Object::Reference(id) => {
            let obj = doc.get_object(*id).ok()?;
            if let Object::Stream(s) = obj {
                s.decompressed_content().ok()
            } else { None }
        }
        Object::Array(arr) => {
            let mut all = Vec::new();
            for item in arr {
                if let Object::Reference(id) = item {
                    if let Ok(Object::Stream(s)) = doc.get_object(*id) {
                        if let Ok(bytes) = s.decompressed_content() {
                            all.extend_from_slice(&bytes);
                            all.push(b'\n');
                        }
                    }
                }
            }
            Some(all)
        }
        Object::Stream(s) => s.decompressed_content().ok(),
        _ => None,
    }
}

#[derive(Debug)]
struct Bbox { min_x: f32, min_y: f32, max_x: f32, max_y: f32 }

#[derive(Clone, Copy)]
struct Mat { a: f32, b: f32, c: f32, d: f32, e: f32, f: f32 }

impl Mat {
    fn identity() -> Self { Mat { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 } }
    fn transform(&self, x: f32, y: f32) -> (f32, f32) {
        (self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f)
    }
    fn pre_concat(&self, m: Mat) -> Mat {
        Mat {
            a: m.a * self.a + m.b * self.c,
            b: m.a * self.b + m.b * self.d,
            c: m.c * self.a + m.d * self.c,
            d: m.c * self.b + m.d * self.d,
            e: m.e * self.a + m.f * self.c + self.e,
            f: m.e * self.b + m.f * self.d + self.f,
        }
    }
}

/// Walks one or more PDF content streams (recursing into Form XObjects)
/// and accumulates the bounding box of every drawn coordinate after
/// applying the current CTM stack.
struct BboxWalker<'a> {
    doc: &'a Document,
    min_x: f32, min_y: f32, max_x: f32, max_y: f32,
    op_counts: HashMap<String, u32>,
    forms_entered: u32,
}

impl<'a> BboxWalker<'a> {
    fn new(doc: &'a Document) -> Self {
        BboxWalker {
            doc,
            min_x: f32::INFINITY, min_y: f32::INFINITY,
            max_x: f32::NEG_INFINITY, max_y: f32::NEG_INFINITY,
            op_counts: HashMap::new(),
            forms_entered: 0,
        }
    }

    fn bbox(&self) -> Option<Bbox> {
        if self.min_x.is_infinite() { None }
        else { Some(Bbox { min_x: self.min_x, min_y: self.min_y, max_x: self.max_x, max_y: self.max_y }) }
    }

    fn record(&mut self, x: f32, y: f32) {
        // Filter out absurd sentinel values that PDF authors sometimes
        // emit for clipping rects (e.g. (-32768, -32768, 32768, 32768)
        // is an i16 range — definitely not real content). These values
        // skew the bbox without representing real visible drawing.
        if x.abs() > 1e6 || y.abs() > 1e6 { return; }
        if x < self.min_x { self.min_x = x; }
        if x > self.max_x { self.max_x = x; }
        if y < self.min_y { self.min_y = y; }
        if y > self.max_y { self.max_y = y; }
    }

    fn walk(&mut self, content_bytes: &[u8], resources: Option<&Dictionary>, depth: u32) {
        if depth > 5 { return; } // safety: prevent infinite recursion
        let content = match Content::decode(content_bytes) {
            Ok(c) => c,
            Err(_) => return,
        };

        let f_op = |o: &Object| -> f32 {
            match o {
                Object::Real(r) => *r as f32,
                Object::Integer(i) => *i as f32,
                _ => 0.0,
            }
        };

        let mut ctm = Mat::identity();
        let mut stack: Vec<Mat> = Vec::new();

        for op in &content.operations {
            *self.op_counts.entry(op.operator.clone()).or_insert(0) += 1;
            match op.operator.as_str() {
                "q" => stack.push(ctm),
                "Q" => { if let Some(m) = stack.pop() { ctm = m; } }
                "cm" => {
                    if op.operands.len() >= 6 {
                        let m = Mat {
                            a: f_op(&op.operands[0]), b: f_op(&op.operands[1]),
                            c: f_op(&op.operands[2]), d: f_op(&op.operands[3]),
                            e: f_op(&op.operands[4]), f: f_op(&op.operands[5]),
                        };
                        ctm = ctm.pre_concat(m);
                    }
                }
                "m" | "l" => {
                    if op.operands.len() >= 2 {
                        let (x, y) = ctm.transform(f_op(&op.operands[0]), f_op(&op.operands[1]));
                        self.record(x, y);
                    }
                }
                "c" => {
                    if op.operands.len() >= 6 {
                        for i in (0..6).step_by(2) {
                            let (x, y) = ctm.transform(f_op(&op.operands[i]), f_op(&op.operands[i + 1]));
                            self.record(x, y);
                        }
                    }
                }
                "v" | "y" => {
                    if op.operands.len() >= 4 {
                        for i in (0..4).step_by(2) {
                            let (x, y) = ctm.transform(f_op(&op.operands[i]), f_op(&op.operands[i + 1]));
                            self.record(x, y);
                        }
                    }
                }
                "re" => {
                    if op.operands.len() >= 4 {
                        let x = f_op(&op.operands[0]);
                        let y = f_op(&op.operands[1]);
                        let w = f_op(&op.operands[2]);
                        let h = f_op(&op.operands[3]);
                        for &(px, py) in &[(x, y), (x + w, y), (x + w, y + h), (x, y + h)] {
                            let (tx, ty) = ctm.transform(px, py);
                            self.record(tx, ty);
                        }
                    }
                }
                "Do" => {
                    // Resolve the XObject and recurse into it if it's a Form.
                    if let Some(name) = op.operands.first().and_then(|o| {
                        if let Object::Name(n) = o { Some(n.clone()) } else { None }
                    }) {
                        if let Some(res) = resources {
                            if let Some((stream, form_resources)) = self.resolve_xobject(res, &name) {
                                let dict = &stream.dict;
                                let subtype = dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok());
                                if subtype == Some(b"Form" as &[u8]) {
                                    self.forms_entered += 1;
                                    // Apply the form's /Matrix on top of current CTM.
                                    let saved_ctm = ctm;
                                    if let Ok(matrix) = dict.get(b"Matrix") {
                                        if let Ok(arr) = matrix.as_array() {
                                            if arr.len() >= 6 {
                                                let m = Mat {
                                                    a: f_op(&arr[0]), b: f_op(&arr[1]),
                                                    c: f_op(&arr[2]), d: f_op(&arr[3]),
                                                    e: f_op(&arr[4]), f: f_op(&arr[5]),
                                                };
                                                ctm = ctm.pre_concat(m);
                                            }
                                        }
                                    }
                                    // Recurse into the form's content stream.
                                    if let Ok(form_bytes) = stream.decompressed_content() {
                                        // We need to track the form's CTM, but
                                        // walk() resets to identity internally —
                                        // so we transform every recorded point
                                        // through ctm afterwards via a fresh
                                        // sub-walker.
                                        let form_res = form_resources.as_ref().or(Some(res));
                                        let mut sub = BboxWalker::new(self.doc);
                                        sub.walk(&form_bytes, form_res, depth + 1);
                                        if let Some(sb) = sub.bbox() {
                                            // Sub bbox is in form's local space.
                                            // Map its 4 corners through the
                                            // CURRENT ctm (which already has
                                            // form Matrix applied).
                                            for &(px, py) in &[
                                                (sb.min_x, sb.min_y),
                                                (sb.max_x, sb.min_y),
                                                (sb.max_x, sb.max_y),
                                                (sb.min_x, sb.max_y),
                                            ] {
                                                let (tx, ty) = ctm.transform(px, py);
                                                self.record(tx, ty);
                                            }
                                        }
                                        for (k, v) in sub.op_counts {
                                            *self.op_counts.entry(k).or_insert(0) += v;
                                        }
                                        self.forms_entered += sub.forms_entered;
                                    }
                                    ctm = saved_ctm;
                                } else {
                                    // Image XObject — unit square
                                    for &(px, py) in &[(0.0_f32, 0.0_f32), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)] {
                                        let (tx, ty) = ctm.transform(px, py);
                                        self.record(tx, ty);
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn resolve_xobject(&self, resources: &Dictionary, name: &[u8]) -> Option<(lopdf::Stream, Option<Dictionary>)> {
        let xobj_dict = resources.get(b"XObject").ok()?;
        let xobj_dict = match xobj_dict {
            Object::Reference(id) => self.doc.get_object(*id).ok()?.clone(),
            other => other.clone(),
        };
        let xobj_dict = xobj_dict.as_dict().ok()?.clone();
        let entry = xobj_dict.get(name).ok()?;
        let stream_obj = match entry {
            Object::Reference(id) => self.doc.get_object(*id).ok()?.clone(),
            other => other.clone(),
        };
        if let Object::Stream(s) = stream_obj {
            // Get form resources if any
            let form_res = s.dict.get(b"Resources").ok().and_then(|o| {
                let resolved = match o {
                    Object::Reference(id) => self.doc.get_object(*id).ok().cloned(),
                    other => Some(other.clone()),
                };
                resolved.and_then(|r| r.as_dict().ok().cloned())
            });
            Some((s, form_res))
        } else {
            None
        }
    }
}

fn get_page_resources(doc: &Document, page_dict: &Dictionary) -> Option<Dictionary> {
    let res = lookup_with_inheritance(doc, page_dict, b"Resources")?;
    match res {
        Object::Dictionary(d) => Some(d),
        Object::Reference(id) => doc.get_object(id).ok().and_then(|o| o.as_dict().ok().cloned()),
        _ => None,
    }
}

fn lookup_with_inheritance(doc: &Document, dict: &lopdf::Dictionary, key: &[u8]) -> Option<Object> {
    if let Ok(v) = dict.get(key) {
        return Some(resolve(v, doc));
    }
    // Walk up via /Parent
    let mut current = dict.clone();
    loop {
        let parent = match current.get(b"Parent") {
            Ok(Object::Reference(id)) => doc.get_object(*id).ok(),
            _ => return None,
        }?;
        let pdict = parent.as_dict().ok()?;
        if let Ok(v) = pdict.get(key) {
            return Some(resolve(v, doc));
        }
        current = pdict.clone();
    }
}

fn resolve(obj: &Object, doc: &Document) -> Object {
    match obj {
        Object::Reference(id) => doc.get_object(*id).cloned().unwrap_or_else(|_| obj.clone()),
        other => other.clone(),
    }
}

fn format_box(o: &Object) -> String {
    if let Object::Array(arr) = o {
        let nums: Vec<String> = arr.iter().map(|x| match x {
            Object::Real(r) => format!("{}", r),
            Object::Integer(i) => format!("{}", i),
            other => format!("{:?}", other),
        }).collect();
        format!("[{}]", nums.join(", "))
    } else {
        format!("{:?}", o)
    }
}
