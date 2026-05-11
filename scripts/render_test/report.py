"""Per-run HTML + JSON report writers."""
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime
import json
from jinja2 import Environment, FileSystemLoader, select_autoescape


@dataclass
class PageResult:
    pdf_path: str
    pdf_version: str
    page_index: int
    diff_pct: float
    ref_filename: str
    app_filename: str
    diff_filename: str
    # Timing fields (milliseconds). Default 0.0 so older callers keep working.
    app_render_ms: float = 0.0   # how long our renderer took (MCP screenshot_page)
    ref_render_ms: float = 0.0   # how long PyMuPDF took
    diff_ms: float = 0.0         # how long the comparison took


def _passed(p: PageResult, fail_pct: float) -> bool:
    return p.diff_pct <= fail_pct


def _aggregate_by_pdf(results: list[PageResult], fail_pct: float):
    by_pdf: dict[str, dict] = {}
    for p in results:
        bucket = by_pdf.setdefault(p.pdf_path, {
            "path": p.pdf_path,
            "version": p.pdf_version,
            "pages": [],
        })
        bucket["pages"].append({
            "index": p.page_index,
            "diff_pct": p.diff_pct,
            "passed": _passed(p, fail_pct),
            "ref_filename": p.ref_filename,
            "app_filename": p.app_filename,
            "diff_filename": p.diff_filename,
            "app_render_ms": p.app_render_ms,
            "ref_render_ms": p.ref_render_ms,
            "diff_ms": p.diff_ms,
        })
    for b in by_pdf.values():
        b["pages"].sort(key=lambda p: p["index"])
        # Per-PDF timing aggregates
        app_times = [pg["app_render_ms"] for pg in b["pages"]]
        ref_times = [pg["ref_render_ms"] for pg in b["pages"]]
        n = max(len(b["pages"]), 1)
        b["app_render_ms_total"] = round(sum(app_times), 2)
        b["app_render_ms_avg"]   = round(sum(app_times) / n, 2)
        b["app_render_ms_max"]   = round(max(app_times) if app_times else 0.0, 2)
        b["ref_render_ms_total"] = round(sum(ref_times), 2)
        b["ref_render_ms_avg"]   = round(sum(ref_times) / n, 2)
    # PDFs with most failures first, then by path for stability
    return sorted(
        by_pdf.values(),
        key=lambda b: (
            -sum(0 if pg["passed"] else 1 for pg in b["pages"]),
            b["path"],
        ),
    )


def _totals(results: list[PageResult], fail_pct: float) -> dict:
    passed = sum(1 for p in results if _passed(p, fail_pct))
    failed = len(results) - passed
    app_times = [p.app_render_ms for p in results]
    ref_times = [p.ref_render_ms for p in results]
    diff_times = [p.diff_ms for p in results]
    n = max(len(results), 1)
    return {
        "pages":  len(results),
        "passed": passed,
        "failed": failed,
        "app_render_ms_total": round(sum(app_times), 2),
        "app_render_ms_avg":   round(sum(app_times) / n, 2),
        "app_render_ms_max":   round(max(app_times) if app_times else 0.0, 2),
        "ref_render_ms_total": round(sum(ref_times), 2),
        "ref_render_ms_avg":   round(sum(ref_times) / n, 2),
        "ref_render_ms_max":   round(max(ref_times) if ref_times else 0.0, 2),
        "diff_ms_total":       round(sum(diff_times), 2),
    }


def write_summary(
    out_path: Path,
    results: list[PageResult],
    git_sha: str,
    config: dict,
) -> None:
    fail_pct = config.get("fail_pct", 2.0)
    pdfs = _aggregate_by_pdf(results, fail_pct)
    payload = {
        "git_sha": git_sha,
        "timestamp": _now_iso(),
        "config": config,
        "pdfs": [
            {
                "path": p["path"],
                "version": p["version"],
                "app_render_ms_total": p["app_render_ms_total"],
                "app_render_ms_avg":   p["app_render_ms_avg"],
                "app_render_ms_max":   p["app_render_ms_max"],
                "ref_render_ms_total": p["ref_render_ms_total"],
                "ref_render_ms_avg":   p["ref_render_ms_avg"],
                "pages": [
                    {
                        "index": pg["index"],
                        "diff_pct": pg["diff_pct"],
                        "passed": pg["passed"],
                        "app_render_ms": pg["app_render_ms"],
                        "ref_render_ms": pg["ref_render_ms"],
                    }
                    for pg in p["pages"]
                ],
            }
            for p in pdfs
        ],
        "totals": _totals(results, fail_pct),
    }
    out_path.write_text(json.dumps(payload, indent=2))


def write_html(
    out_path: Path,
    results: list[PageResult],
    git_sha: str,
    config: dict,
) -> None:
    fail_pct = config.get("fail_pct", 2.0)
    pdfs = _aggregate_by_pdf(results, fail_pct)

    env = Environment(
        loader=FileSystemLoader(str(Path(__file__).parent / "templates")),
        autoescape=select_autoescape(['html']),
    )
    tmpl = env.get_template("report.html.j2")
    html = tmpl.render(
        git_sha=git_sha,
        config={
            "width": config.get("width", 2000),
            "fail_pct": fail_pct,
            "blur_sigma": config.get("blur_sigma", 1.0),
            "pixel_tol": config.get("pixel_tol", 30),
        },
        pdfs=pdfs,
        totals=_totals(results, fail_pct),
    )
    out_path.write_text(html)


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")
