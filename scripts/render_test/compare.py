"""Pixel-diff with Gaussian blur, plus a side-by-side overlay for human review."""
from typing import Tuple
import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageDraw


def compare(
    ref: Image.Image,
    app: Image.Image,
    blur_sigma: float = 1.0,
    pixel_tol: int = 30,
) -> Tuple[float, Image.Image]:
    """
    Returns (diff_pct, overlay_image).

    Blur both images with Gaussian sigma, then count pixels where the sum of
    per-channel RGB differences exceeds `pixel_tol`. `diff_pct` is the
    percentage of such pixels (0..100).
    """
    if ref.mode != "RGB":
        ref = ref.convert("RGB")
    if app.mode != "RGB":
        app = app.convert("RGB")

    if app.size != ref.size:
        app = app.resize(ref.size, Image.LANCZOS)

    ref_b = ref.filter(ImageFilter.GaussianBlur(blur_sigma))
    app_b = app.filter(ImageFilter.GaussianBlur(blur_sigma))

    diff = ImageChops.difference(ref_b, app_b)
    arr = np.asarray(diff, dtype=np.int32)
    mask = arr.sum(axis=2) > pixel_tol
    pct = float(mask.mean()) * 100.0

    overlay = _make_overlay(ref, app, mask)
    return pct, overlay


def _make_overlay(
    ref: Image.Image,
    app: Image.Image,
    mask: np.ndarray,
) -> Image.Image:
    """Render ref / app / diff side-by-side. Diff = ref tinted red where mask is True."""
    h = ref.height
    composite = Image.new("RGB", (ref.width * 3 + 20, h + 20), (32, 32, 32))
    composite.paste(ref, (5, 5))
    composite.paste(app, (ref.width + 10, 5))

    diff_img = ref.copy().convert("RGB")
    pixels = np.array(diff_img)
    pixels[mask] = [255, 0, 0]
    diff_img = Image.fromarray(pixels)
    composite.paste(diff_img, (ref.width * 2 + 15, 5))

    d = ImageDraw.Draw(composite)
    d.text(
        (5, h + 7),
        "REF      |      APP      |      DIFF (red = >30 per-channel sum after blur)",
        fill=(220, 220, 220),
    )
    return composite
