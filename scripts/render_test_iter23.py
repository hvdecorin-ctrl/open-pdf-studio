#!/usr/bin/env python
"""Standalone render-regression test using the open-pdf-render literal binary
directly (no MCP server needed). Uses the same PyMuPDF reference + compare
pipeline as the canonical render-regression-test, just calls the renderer
through subprocess instead of HTTP.

Usage:
  python scripts/render_test_iter23.py
"""
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from render_test.reference import render_with_pymupdf
from render_test.compare import compare

RENDER_BIN = ROOT / "open-pdf-render" / "target" / "release" / "examples" / "render_page_literal.exe"
PDF_DIR = ROOT / "test pdf-bestanden" / "Originele bestanden"

# Page lists per PDF; matches the regression-test plan from the
# render-regression-test app harness.
TEST_PLAN = [
    ("Tekst.pdf", 5),
    ("Text pdf gecombineerd.pdf", 28),
    ("rapport-constructie.pdf", 28),
    ("Combinatie Raster, vector, tekening images.pdf", 1),
    ("Technische tekening.pdf", 4),
    ("Zware vector PDF.pdf", 19),
    ("2885 Demo project.pdf", 14),
    ("20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf", 7),
]

WIDTH = 2000
BLUR_SIGMA = 1.0
PIXEL_TOL = 30
FAIL_PCT = 2.0


def render_app(pdf: Path, page: int, width: int) -> Image.Image:
    """Run the literal-renderer binary and load the resulting PNG."""
    out = ROOT / f"_iter23_render_p{page}.png"
    cmd = [str(RENDER_BIN), str(pdf), str(page), str(width), str(out)]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if res.returncode != 0:
        raise RuntimeError(f"render binary failed for {pdf.name} p{page}: {res.stderr}")
    img = Image.open(out).convert("RGBA")
    # Convert to RGB for compare()
    bg = Image.new("RGB", img.size, (255, 255, 255))
    bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
    return bg


def main():
    if not RENDER_BIN.exists():
        print(f"Render binary missing: {RENDER_BIN}", file=sys.stderr)
        return 1
    total = 0
    passed = 0
    failures = []
    for pdf_name, n_pages in TEST_PLAN:
        pdf = PDF_DIR / pdf_name
        if not pdf.exists():
            print(f"SKIP missing PDF: {pdf_name}")
            continue
        for page in range(n_pages):
            total += 1
            try:
                ref = render_with_pymupdf(pdf, page, WIDTH)
                app = render_app(pdf, page, WIDTH)
                pct, _ = compare(ref, app, BLUR_SIGMA, PIXEL_TOL)
                status = "PASS" if pct <= FAIL_PCT else "FAIL"
                if status == "PASS":
                    passed += 1
                else:
                    failures.append((pdf_name, page, pct))
                print(f"  {pdf_name[:50]:50} p{page:2d}  {pct:6.2f}%  {status}")
            except Exception as e:
                print(f"  {pdf_name[:50]:50} p{page:2d}  ERROR: {e}")
                failures.append((pdf_name, page, 100.0))
    print(f"\n=== Result: {passed}/{total} passed ===")
    if failures:
        print(f"Failures: {len(failures)}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
