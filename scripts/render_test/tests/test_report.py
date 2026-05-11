import json
from pathlib import Path
from render_test.report import write_summary, write_html, PageResult


def _sample_results():
    return [
        PageResult(
            pdf_path="a.pdf", pdf_version="1.7", page_index=0,
            diff_pct=0.42,
            ref_filename="a_p0_ref.png",
            app_filename="a_p0_app.png",
            diff_filename="a_p0_diff.png",
        ),
        PageResult(
            pdf_path="b.pdf", pdf_version="1.4", page_index=0,
            diff_pct=8.7,
            ref_filename="b_p0_ref.png",
            app_filename="b_p0_app.png",
            diff_filename="b_p0_diff.png",
        ),
    ]


def test_summary_json_schema(tmp_path: Path):
    results = _sample_results()
    write_summary(
        tmp_path / "summary.json", results,
        git_sha="abc1234",
        config={"width": 2000, "fail_pct": 2.0},
    )
    data = json.loads((tmp_path / "summary.json").read_text())
    assert data["git_sha"] == "abc1234"
    assert data["totals"]["pages"] == 2
    assert data["totals"]["passed"] == 1
    assert data["totals"]["failed"] == 1
    assert len(data["pdfs"]) == 2


def test_html_renders_without_external_cdn(tmp_path: Path):
    results = _sample_results()
    write_html(
        tmp_path / "report.html", results,
        git_sha="abc1234",
        config={"fail_pct": 2.0},
    )
    html = (tmp_path / "report.html").read_text()
    assert "<html" in html.lower()
    # No external script/style URLs (must be self-contained)
    assert "https://" not in html
    assert "abc1234" in html
    assert "8.7" in html


def test_summary_includes_timing_stats(tmp_path: Path):
    """Per-page render timings should aggregate into totals and per-PDF stats."""
    results = [
        PageResult(
            pdf_path="a.pdf", pdf_version="1.7", page_index=0,
            diff_pct=0.42,
            ref_filename="a_p0_ref.png",
            app_filename="a_p0_app.png",
            diff_filename="a_p0_diff.png",
            app_render_ms=143.5, ref_render_ms=42.1, diff_ms=8.7,
        ),
    ]
    write_summary(
        tmp_path / "summary.json", results,
        git_sha="x",
        config={"width": 2000, "fail_pct": 2.0},
    )
    data = json.loads((tmp_path / "summary.json").read_text())
    # Totals expose the new timing fields
    assert "app_render_ms_total" in data["totals"]
    assert data["totals"]["app_render_ms_total"] == 143.5
    assert data["totals"]["app_render_ms_avg"]   == 143.5
    assert data["totals"]["app_render_ms_max"]   == 143.5
    assert data["totals"]["ref_render_ms_total"] == 42.1
    assert data["totals"]["diff_ms_total"]       == 8.7
    # Per-PDF aggregates
    assert data["pdfs"][0]["app_render_ms_avg"] == 143.5
    assert data["pdfs"][0]["app_render_ms_max"] == 143.5
    assert data["pdfs"][0]["ref_render_ms_avg"] == 42.1
    # Per-page row exposes raw ms
    assert data["pdfs"][0]["pages"][0]["app_render_ms"] == 143.5
    assert data["pdfs"][0]["pages"][0]["ref_render_ms"] == 42.1


def test_summary_aggregates_multiple_pages(tmp_path: Path):
    """avg/max should be computed over the full page set."""
    results = [
        PageResult(
            pdf_path="a.pdf", pdf_version="1.7", page_index=0,
            diff_pct=0.0,
            ref_filename="-", app_filename="-", diff_filename="-",
            app_render_ms=100.0, ref_render_ms=40.0,
        ),
        PageResult(
            pdf_path="a.pdf", pdf_version="1.7", page_index=1,
            diff_pct=0.0,
            ref_filename="-", app_filename="-", diff_filename="-",
            app_render_ms=300.0, ref_render_ms=60.0,
        ),
    ]
    write_summary(
        tmp_path / "summary.json", results,
        git_sha="x", config={"fail_pct": 2.0},
    )
    data = json.loads((tmp_path / "summary.json").read_text())
    assert data["totals"]["app_render_ms_total"] == 400.0
    assert data["totals"]["app_render_ms_avg"]   == 200.0
    assert data["totals"]["app_render_ms_max"]   == 300.0
    assert data["pdfs"][0]["app_render_ms_avg"]  == 200.0
    assert data["pdfs"][0]["app_render_ms_max"]  == 300.0


def test_html_includes_timing_column(tmp_path: Path):
    """The HTML report should display per-page render time."""
    results = [
        PageResult(
            pdf_path="a.pdf", pdf_version="1.7", page_index=0,
            diff_pct=0.42,
            ref_filename="a_p0_ref.png",
            app_filename="a_p0_app.png",
            diff_filename="a_p0_diff.png",
            app_render_ms=143.5, ref_render_ms=42.1,
        ),
    ]
    write_html(
        tmp_path / "report.html", results,
        git_sha="x", config={"fail_pct": 2.0},
    )
    html = (tmp_path / "report.html").read_text()
    # Column heading and a recognizable timing value should appear
    assert "App ms" in html
    assert "Ref ms" in html
    assert "144" in html or "143" in html  # rounded display
    # Summary box for app render
    assert "App render" in html


def test_pageresult_defaults_back_compatible():
    """Old callers that don't pass timing fields should still construct cleanly."""
    p = PageResult(
        pdf_path="a.pdf", pdf_version="1.7", page_index=0,
        diff_pct=0.0,
        ref_filename="-", app_filename="-", diff_filename="-",
    )
    assert p.app_render_ms == 0.0
    assert p.ref_render_ms == 0.0
    assert p.diff_ms == 0.0
