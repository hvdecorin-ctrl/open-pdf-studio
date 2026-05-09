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
        })
    for b in by_pdf.values():
        b["pages"].sort(key=lambda p: p["index"])
    # PDFs with most failures first, then by path for stability
    return sorted(
        by_pdf.values(),
        key=lambda b: (
            -sum(0 if pg["passed"] else 1 for pg in b["pages"]),
            b["path"],
        ),
    )


def write_summary(
    out_path: Path,
    results: list[PageResult],
    git_sha: str,
    config: dict,
) -> None:
    fail_pct = config.get("fail_pct", 2.0)
    pdfs = _aggregate_by_pdf(results, fail_pct)
    passed = sum(1 for p in results if _passed(p, fail_pct))
    failed = len(results) - passed
    payload = {
        "git_sha": git_sha,
        "timestamp": _now_iso(),
        "config": config,
        "pdfs": [
            {
                "path": p["path"],
                "version": p["version"],
                "pages": [
                    {
                        "index": pg["index"],
                        "diff_pct": pg["diff_pct"],
                        "passed": pg["passed"],
                    }
                    for pg in p["pages"]
                ],
            }
            for p in pdfs
        ],
        "totals": {"pages": len(results), "passed": passed, "failed": failed},
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
    passed = sum(1 for p in results if _passed(p, fail_pct))
    failed = len(results) - passed

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
        totals={"pages": len(results), "passed": passed, "failed": failed},
    )
    out_path.write_text(html)


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")
