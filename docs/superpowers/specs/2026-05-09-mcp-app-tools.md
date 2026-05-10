# MCP "live app" tools (`app_*`) — spec

Status: implemented (iter `mcp-app-tools-2026-05-09`)
Author: Claude (mcp-app-tools agent)

The existing MCP server (see `2026-05-08-render-regression-test-design.md`)
exposes only **headless** rendering tools (`screenshot_page`, `screenshot_all`,
`get_pdf_metadata`, `list_test_pdfs`). Those drive the pure-Rust
`open-pdf-render` engine and never touch the running Tauri WebView — perfect
for renderer regression testing, useless for reproducing UI bugs that depend
on the live app's state (zoom, scroll, panel visibility, annotation overlay,
etc.).

This iter adds five new tools that drive the **live** WebView from outside,
so a future agent (e.g. the zoom-bug-fix iter) can:

1. Open a PDF in a fresh tab,
2. Set or step the zoom,
3. Capture the resulting canvas + overlays,

…all over the same JSON-RPC channel, without ever clicking the GUI.

## Architecture

```
┌────────────────────────┐    HTTP JSON-RPC     ┌────────────────────────┐
│ test harness / curl    │ ────────────────────►│ Rust MCP server (axum) │
│                        │ ◄──────────────────── │  port 9223 / 9224      │
└────────────────────────┘                       └─────────┬──────────────┘
                                                           │
                                                  Tauri Emitter::emit
                                                  "mcp:open-pdf" etc.
                                                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ WebView (js/mcp-bridge.js)                                          │
│  Listens for mcp:* events, runs the matching app function           │
│  (loadPDF / setZoom / canvas.toDataURL), calls the Rust command     │
│  `app_response(request_id, result)` to deliver the answer.          │
└─────────────────────────────────────────────────────────────────────┘
                                                           │
                                                  oneshot::Receiver
                                                  in mcp_app_bridge
                                                           ▼
                                                 tool returns the JSON
```

The Rust side (`src-tauri/src/mcp_app_bridge.rs`) keeps a `HashMap<u64,
oneshot::Sender<Value>>` keyed by request id. Each `app_*` tool allocates
an id, emits the matching `mcp:*` event with `{request_id, params}`,
then `tokio::time::timeout`-awaits the oneshot. The JS side
(`js/mcp-bridge.js`) calls back through the new `app_response` Tauri
command, which removes the sender from the map and forwards the result.

## Tool reference

All tools live under `tools/call`. Curl examples assume the server is on
`127.0.0.1:9224` (start with `OPS_ENABLE_MCP=1 npm run tauri -- dev -- -- --mcp-server --mcp-port 9224`).

### `app_open_pdf`

Open a PDF in a new tab (or focus the existing tab if already open).

| param  | type   | required |
|--------|--------|----------|
| `path` | string | yes      |

Returns:

```json
{ "ok": true, "tab_id": <int>, "page_count": <int>, "file_path": <string> }
```

```bash
curl -s -X POST http://127.0.0.1:9224/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"app_open_pdf","arguments":{"path":"C:/.../Tekst.pdf"}}}'
```

Timeout: 60 s (loading large PDFs can take a while).

### `app_set_zoom`

Set the page-view zoom to an absolute scale factor.

| param   | type   | required | range            |
|---------|--------|----------|------------------|
| `scale` | number | yes      | `0.05` … `32.0`  |

`scale=1.0` is 100 %.

Returns:

```json
{ "ok": true, "requested": <number>, "actual": <number|null> }
```

`actual` is read back from the live viewport (vector mode clamps to the
configured min/max), or `null` when no document is open.

```bash
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"app_set_zoom","arguments":{"scale":1.5}}}'
```

### `app_zoom_in` / `app_zoom_out`

Trigger one toolbar-equivalent zoom step. No params.

Returns: `{ "ok": true, "actual": <number|null> }`

```bash
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"app_zoom_in","arguments":{}}}'
```

### `app_screenshot_view`

Composite the current page view (`#pdf-canvas` + `#text-highlight-canvas`
+ `#annotation-canvas`) into a PNG and return it as base64.

| param   | type    | required | default |
|---------|---------|----------|---------|
| `width` | integer | no       | `2000`  |

`width` is the maximum longer-side pixel size of the composite — the
output is scaled down (preserving aspect) when the live canvas is larger.
Note: this captures the **canvas** only, not the surrounding chrome
(toolbars, panels). For a full-window grab use OS-level screenshotting.

Returns:

```json
{ "ok": true, "png_base64": "<no-prefix-base64>", "width": <int>, "height": <int> }
```

```bash
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"app_screenshot_view","arguments":{"width":1200}}}'
```

## Reproducing the zoom-bug (out-of-scope for this iter)

The user-reported bug: "De 1e pagina van een pdf heeft iets geks dat als
je inzoomt/uitzoomt dat de view in een soort kader komt" — the first page
ends up "in some kind of frame" when zooming. With the new tools the
follow-up iter can script:

```bash
# 1. open a multi-page pdf
curl ... app_open_pdf {"path": "..."}
# 2. screenshot the baseline
curl ... app_screenshot_view {"width": 1600}     # save as p0_baseline.png
# 3. zoom in twice
curl ... app_zoom_in {}
curl ... app_zoom_in {}
# 4. screenshot after zoom
curl ... app_screenshot_view {"width": 1600}     # save as p0_zoomed.png
# 5. zoom back out
curl ... app_zoom_out {}
curl ... app_zoom_out {}
# 6. screenshot — bug shows itself here as a visible frame around the page
curl ... app_screenshot_view {"width": 1600}     # save as p0_back.png
```

Diff `p0_baseline.png` vs `p0_back.png` to confirm the bug, iterate on a
fix in `pdf/renderer.js` / `pdf/pdf-viewport.js`, re-run.

## Operational notes

- The MCP server now starts from `tauri::Builder::setup()` so the
  `app_*` tools have access to the `AppHandle` they need to emit events.
  The headless tools (`screenshot_page` etc.) keep working unchanged.
- Tests instantiate `AppState { app_handle: None, .. }` and exercise the
  pure-Rust tools directly; calling an `app_*` tool against such a state
  returns an "AppHandle unavailable" error instead of panicking.
- The bridge logs `[mcp-bridge] WebView ready, listening for: [...]` to
  the app's stderr once the JS side has registered all listeners — useful
  for confirming the bridge is wired before sending tool calls.
- Each `app_*` tool has its own timeout (60 s for `app_open_pdf`, 30 s
  for `app_screenshot_view`, 15 s for the rest). On timeout the pending
  oneshot is cleaned up so request IDs don't leak.
