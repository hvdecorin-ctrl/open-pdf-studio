import numpy as np
from PIL import Image, ImageDraw

from render_test.compare import compare


def _solid(color, size=(100, 100)):
    return Image.new("RGB", size, color)


def test_identical_images_zero_diff():
    a = _solid((128, 128, 128))
    b = _solid((128, 128, 128))
    pct, _ = compare(a, b)
    assert pct == 0.0


def test_inverted_images_high_diff():
    a = _solid((0, 0, 0))
    b = _solid((255, 255, 255))
    pct, _ = compare(a, b)
    assert pct > 95.0


def test_subpixel_aa_difference_low_diff():
    """Two images with a 1-px-shifted line should differ by < 5% after blur."""
    a = Image.new("RGB", (200, 200), (255, 255, 255))
    b = Image.new("RGB", (200, 200), (255, 255, 255))
    d_a = ImageDraw.Draw(a); d_a.line([(50, 100), (150, 100)], fill=(0, 0, 0), width=1)
    d_b = ImageDraw.Draw(b); d_b.line([(50, 101), (150, 101)], fill=(0, 0, 0), width=1)
    pct, _ = compare(a, b)
    assert 0.0 < pct < 5.0


def test_resizes_app_to_match_ref():
    a = _solid((100, 100, 100), size=(200, 200))
    b = _solid((100, 100, 100), size=(180, 180))
    pct, _ = compare(a, b)
    # Blur removes resize artifacts; uniform color so diff stays low.
    assert pct < 1.0


def test_overlay_is_an_image():
    a = _solid((255, 255, 255))
    b = _solid((255, 0, 0))
    _, overlay = compare(a, b)
    assert isinstance(overlay, Image.Image)
    assert overlay.size[0] >= a.size[0]  # side-by-side composition
