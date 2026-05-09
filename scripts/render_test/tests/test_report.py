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
