"""Thin MCP HTTP client for the open-pdf-studio test server.

The server speaks JSON-RPC 2.0 over POST /mcp (no SSE — request/response only).
This wrapper hides the JSON-RPC envelope so callers see plain Python dicts.
"""
import base64
import json
from io import BytesIO
from pathlib import Path
from typing import Any
from PIL import Image
import httpx


class AppClient:
    """Synchronous MCP-over-HTTP client. One JSON-RPC request per call."""

    def __init__(self, url: str = "http://127.0.0.1:9223/mcp", timeout: float = 60.0):
        self.url = url
        self._client = httpx.Client(timeout=timeout)
        self._next_id = 0

    def _next(self) -> int:
        self._next_id += 1
        return self._next_id

    def _call(self, method: str, params: dict[str, Any] | None = None) -> dict:
        payload = {
            "jsonrpc": "2.0",
            "id": self._next(),
            "method": method,
            "params": params or {},
        }
        r = self._client.post(
            self.url,
            json=payload,
            headers={"Accept": "application/json"},
        )
        r.raise_for_status()
        body = r.json()
        if "error" in body:
            err = body["error"]
            raise RuntimeError(
                f"MCP error {err.get('code')}: {err.get('message')}"
            )
        return body["result"]

    def initialize(self) -> dict:
        return self._call("initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {
                "name": "render-regression-test",
                "version": "0.1",
            },
        })

    def list_tools(self) -> list[dict]:
        return self._call("tools/list").get("tools", [])

    def list_test_pdfs(self) -> list[dict]:
        result = self._call("tools/call", {
            "name": "list_test_pdfs",
            "arguments": {},
        })
        return json.loads(result["content"][0]["text"])["pdfs"]

    def get_pdf_metadata(self, path: Path | str) -> dict:
        result = self._call("tools/call", {
            "name": "get_pdf_metadata",
            "arguments": {"path": str(path)},
        })
        return json.loads(result["content"][0]["text"])

    def screenshot_page(
        self,
        path: Path | str,
        page_index: int,
        width: int = 2000,
    ) -> Image.Image:
        result = self._call("tools/call", {
            "name": "screenshot_page",
            "arguments": {
                "path": str(path),
                "page_index": page_index,
                "width": width,
            },
        })
        body = json.loads(result["content"][0]["text"])
        png_bytes = base64.b64decode(body["png_base64"])
        return Image.open(BytesIO(png_bytes)).convert("RGB")

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        self.initialize()
        return self

    def __exit__(self, *_args):
        self.close()
