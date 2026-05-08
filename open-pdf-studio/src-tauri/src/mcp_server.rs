//! In-process MCP server. Started by `--mcp-server` CLI flag and used by the
//! render-regression-test harness to drive the renderer over JSON-RPC. Refuses
//! to start in release builds unless the `OPS_ENABLE_MCP=1` environment
//! variable is set, so production users can never accidentally expose the
//! server.
//!
//! ## Why hand-rolled instead of `rmcp`?
//!
//! The plan originally targeted `rmcp = "0.7"` with a `transport-streamable-
//! http-server` feature. The published `rmcp` crate has shifted to a
//! macro-driven `tool_router` / `tool_handler` design (1.x) that requires
//! `schemars` and a particular ToolRouter wiring pattern, and the public
//! types/feature-flags have moved between minor versions. Since this scaffold
//! only needs three JSON-RPC methods (`initialize`, `tools/list`,
//! `tools/call`), we use plain `axum` + `serde_json` and dispatch on the
//! method string. Tool-handler logic added in tasks 6-9 plugs into the
//! existing `tools/call` match arm.
//!
//! ## Wire protocol
//!
//! POST `/mcp` with a JSON-RPC 2.0 request body. Responses are JSON-RPC 2.0
//! response objects (no SSE streaming — clients that need streaming should
//! poll, but the harness uses request/response only).
//!
//! ## Test corpus directory
//!
//! `test_pdfs_dir` is captured at server-start time and stashed in the
//! `AppState` so future tool handlers (Task 6: `list_test_pdfs`) can resolve
//! relative paths without touching the process CWD again.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};

/// Per-server state. Cloned (cheaply, via Arc) into every request handler.
#[derive(Clone)]
pub struct AppState {
    pub test_pdfs_dir: Arc<PathBuf>,
}

/// Standard JSON-RPC error codes used by this server. Codes not yet
/// dispatched in handler bodies are kept available for tool handlers added
/// in tasks 7-9.
#[allow(dead_code)]
mod jsonrpc_error {
    pub const PARSE_ERROR: i32 = -32700;
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const INTERNAL_ERROR: i32 = -32603;
}

/// Build a JSON-RPC 2.0 success response.
fn rpc_result(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

/// Build a JSON-RPC 2.0 error response.
fn rpc_error(id: Value, code: i32, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message.into(),
        },
    })
}

/// Handle the MCP `initialize` method. Identifies the server and advertises
/// the `tools` capability (the actual list will populate as tasks 6-9 land).
fn handle_initialize() -> Value {
    json!({
        "protocolVersion": "2025-03-26",
        "serverInfo": {
            "name": "open-pdf-studio",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": {
            "tools": {
                "listChanged": false
            }
        },
    })
}

/// Handle `tools/list`. Tasks 7-9 will append their tool descriptors to
/// this array.
fn handle_tools_list() -> Value {
    json!({
        "tools": [
            {
                "name": "list_test_pdfs",
                "description": "List all PDFs in the test corpus directory.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "screenshot_page",
                "description": "Render a single PDF page to PNG (returned as base64).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path":       { "type": "string" },
                        "page_index": { "type": "integer", "minimum": 0 },
                        "width":      { "type": "integer", "minimum": 1, "default": 2000 }
                    },
                    "required": ["path", "page_index"],
                    "additionalProperties": false
                }
            }
        ]
    })
}

/// Dispatch a `tools/call` request to the matching tool handler. Returns
/// the tool's MCP-shaped result (`content[]` + `isError`) on success, or a
/// `(code, message)` pair that the caller wraps in a JSON-RPC error
/// response. Tasks 7-9 add new arms to the inner `match`.
async fn handle_tools_call(state: &AppState, params: &Value) -> Result<Value, (i32, String)> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("<missing>");
    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
    match name {
        "list_test_pdfs" => tool_list_test_pdfs(state).await,
        "screenshot_page" => tool_screenshot_page(state, &arguments).await,
        other => Err((
            jsonrpc_error::METHOD_NOT_FOUND,
            format!("method not found: {other}"),
        )),
    }
}

/// `list_test_pdfs` tool — enumerates every `*.pdf` under
/// `state.test_pdfs_dir` and returns its absolute path, file size, and
/// page count. Page count is read with `lopdf::Document::load_mem` inside
/// `spawn_blocking` because lopdf does synchronous I/O.
///
/// The result is shaped per the MCP convention: a single text content
/// block whose `text` field is a JSON-encoded payload. The harness in
/// Task 13 decodes this string to recover the structured `pdfs` array.
async fn tool_list_test_pdfs(state: &AppState) -> Result<Value, (i32, String)> {
    let dir: &PathBuf = &state.test_pdfs_dir;
    let mut entries = match tokio::fs::read_dir(dir.as_path()).await {
        Ok(e) => e,
        Err(e) => {
            return Err((
                jsonrpc_error::INTERNAL_ERROR,
                format!("could not read test corpus dir {:?}: {e}", dir),
            ));
        }
    };

    let mut pdfs: Vec<Value> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("pdf") {
            continue;
        }
        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        // page count: lopdf reads from disk synchronously, so do it on a
        // blocking thread to keep the runtime responsive.
        let path_for_count = path.clone();
        let page_count = tokio::task::spawn_blocking(move || {
            std::fs::read(&path_for_count)
                .ok()
                .and_then(|b| lopdf::Document::load_mem(&b).ok())
                .map(|doc| doc.get_pages().len())
                .unwrap_or(0)
        })
        .await
        .unwrap_or(0);
        pdfs.push(json!({
            "path":       path.to_string_lossy(),
            "page_count": page_count,
            "file_size":  metadata.len(),
        }));
    }
    pdfs.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));

    Ok(json!({
        "content": [{
            "type": "text",
            "text": json!({ "pdfs": pdfs }).to_string(),
        }],
        "isError": false,
    }))
}

/// `screenshot_page` tool — renders a single PDF page via `open_pdf_render`
/// at a target output width (in pixels) and returns the PNG bytes encoded as
/// base64. The MCP harness uses this to compare current renders against
/// committed reference PNGs.
///
/// Scaling matches the convention used by `render_thumbnail` in `lib.rs`:
/// `scale = width / max(page_w_pt, page_h_pt)`, so portrait and landscape
/// pages both fit within `width` pixels on their longest side.
async fn tool_screenshot_page(
    _state: &AppState,
    arguments: &Value,
) -> Result<Value, (i32, String)> {
    let path = arguments
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (jsonrpc_error::INVALID_PARAMS, "missing 'path'".to_string()))?
        .to_string();
    let page_index = arguments
        .get("page_index")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| (jsonrpc_error::INVALID_PARAMS, "missing or invalid 'page_index'".to_string()))?
        as usize;
    let width = arguments
        .get("width")
        .and_then(|v| v.as_u64())
        .unwrap_or(2000) as u32;
    if width == 0 {
        return Err((jsonrpc_error::INVALID_PARAMS, "'width' must be > 0".to_string()));
    }

    let pdf_bytes = tokio::fs::read(&path).await.map_err(|e| {
        (
            jsonrpc_error::INTERNAL_ERROR,
            format!("read {}: {e}", path),
        )
    })?;

    let rendered = tokio::task::spawn_blocking(move || -> Result<open_pdf_render::RenderedPage, String> {
        let doc = open_pdf_render::DocumentHandle::load(&pdf_bytes)
            .map_err(|e| format!("load PDF: {e}"))?;
        let (w_pt, h_pt) = doc
            .page_dimensions(page_index)
            .map_err(|e| format!("page_dimensions: {e}"))?;
        let scale = width as f32 / w_pt.max(h_pt);
        doc.render_page(page_index, scale, 0)
            .map_err(|e| format!("render: {e}"))
    })
    .await
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("render task panic: {e}")))?
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?;

    let png_b64 = crate::render_to_png::encode_rgba_to_png_base64(
        rendered.width,
        rendered.height,
        &rendered.rgba,
    )
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("encode png: {e}")))?;

    let payload = json!({
        "png_base64": png_b64,
        "width":  rendered.width,
        "height": rendered.height,
    });

    Ok(json!({
        "content": [{
            "type": "text",
            "text": payload.to_string(),
        }],
        "isError": false,
    }))
}

/// Axum POST handler for `/mcp`. Parses the JSON-RPC envelope and dispatches
/// on the `method` field.
async fn mcp_handler(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    // Pull out the request id; default to null so error responses are still
    // well-formed if the client omitted it.
    let id = body.get("id").cloned().unwrap_or(Value::Null);

    let method = match body.get("method").and_then(|v| v.as_str()) {
        Some(m) => m,
        None => {
            return (
                StatusCode::OK,
                Json(rpc_error(
                    id,
                    jsonrpc_error::INVALID_REQUEST,
                    "missing 'method' field",
                )),
            );
        }
    };

    let response = match method {
        "initialize" => rpc_result(id, handle_initialize()),
        "tools/list" => rpc_result(id, handle_tools_list()),
        "tools/call" => {
            let empty = Value::Null;
            let params = body.get("params").unwrap_or(&empty);
            match handle_tools_call(&state, params).await {
                Ok(value) => rpc_result(id, value),
                Err((code, msg)) => rpc_error(id, code, msg),
            }
        }
        // `notifications/initialized` and other notification methods carry no
        // id and expect no response. We still send back an empty result for
        // robustness; the harness ignores unknown ids.
        "notifications/initialized" | "initialized" => rpc_result(id, json!({})),
        other => rpc_error(
            id,
            jsonrpc_error::METHOD_NOT_FOUND,
            format!("method not found: {other}"),
        ),
    };

    (StatusCode::OK, Json(response))
}

/// Start the MCP server. This is an async function that runs forever (until
/// the binding errors or the process exits). Callers should `tauri::async_
/// runtime::spawn` it from `lib::run` so the Tauri event loop continues.
///
/// In release builds, the server refuses to start unless `OPS_ENABLE_MCP=1`
/// is set in the environment.
pub async fn start(port: u16, test_pdfs_dir: PathBuf) -> Result<(), String> {
    if !cfg!(debug_assertions) && std::env::var("OPS_ENABLE_MCP").as_deref() != Ok("1") {
        return Err(
            "MCP server refused to start: release build without OPS_ENABLE_MCP=1".into(),
        );
    }

    let state = AppState {
        test_pdfs_dir: Arc::new(test_pdfs_dir),
    };

    let app = Router::new()
        .route("/mcp", post(mcp_handler))
        .with_state(state);

    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e: std::net::AddrParseError| format!("bad addr: {e}"))?;

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("bind {addr}: {e}"))?;

    eprintln!("MCP server listening on http://127.0.0.1:{port}/mcp");

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("MCP server error: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_response_shape() {
        let v = handle_initialize();
        assert_eq!(v["serverInfo"]["name"], "open-pdf-studio");
        assert_eq!(v["serverInfo"]["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(v["capabilities"]["tools"]["listChanged"], false);
        assert_eq!(v["protocolVersion"], "2025-03-26");
    }

    #[test]
    fn tools_list_advertises_list_test_pdfs() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools must be an array");
        assert!(
            arr.iter().any(|t| t["name"] == "list_test_pdfs"),
            "tools list must advertise list_test_pdfs, got: {arr:?}"
        );
        let tool = arr
            .iter()
            .find(|t| t["name"] == "list_test_pdfs")
            .expect("descriptor present");
        assert_eq!(tool["inputSchema"]["type"], "object");
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
    }

    /// Exercises the real `tool_list_test_pdfs` over a fixture directory.
    /// We point `AppState.test_pdfs_dir` at the repo's actual test corpus
    /// (`../../test pdf-bestanden/Originele bestanden`) so this also serves
    /// as a smoke test when the GUI binary cannot be launched.
    #[test]
    fn tool_list_test_pdfs_returns_corpus_entries() {
        // Resolve corpus relative to this crate's manifest dir so the test is
        // CWD-independent.
        let corpus = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("test pdf-bestanden")
            .join("Originele bestanden");
        if !corpus.is_dir() {
            // Skip gracefully if the corpus isn't checked in on this clone.
            eprintln!("skipping: corpus dir not found at {:?}", corpus);
            return;
        }

        let state = AppState {
            test_pdfs_dir: Arc::new(corpus),
        };
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        let value = rt
            .block_on(tool_list_test_pdfs(&state))
            .expect("tool_list_test_pdfs ok");

        assert_eq!(value["isError"], false);
        let text = value["content"][0]["text"]
            .as_str()
            .expect("text content present");
        let payload: Value =
            serde_json::from_str(text).expect("text payload is valid JSON");
        let pdfs = payload["pdfs"].as_array().expect("pdfs is an array");
        assert!(
            !pdfs.is_empty(),
            "expected at least one PDF in the corpus, got payload {payload}"
        );
        for entry in pdfs {
            assert!(entry["path"].is_string(), "path is string");
            assert!(entry["file_size"].is_u64(), "file_size is unsigned int");
            assert!(
                entry["page_count"].as_u64().unwrap_or(0) > 0,
                "page_count > 0 for {}",
                entry["path"]
            );
        }
    }

    #[test]
    fn tools_list_advertises_screenshot_page() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools must be an array");
        let tool = arr
            .iter()
            .find(|t| t["name"] == "screenshot_page")
            .expect("screenshot_page descriptor present");
        assert_eq!(tool["inputSchema"]["type"], "object");
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
        let required = tool["inputSchema"]["required"]
            .as_array()
            .expect("required is array");
        let names: Vec<&str> = required.iter().filter_map(|v| v.as_str()).collect();
        assert!(names.contains(&"path"));
        assert!(names.contains(&"page_index"));
    }

    #[tokio::test]
    async fn tool_screenshot_page_returns_png_base64() {
        use std::path::PathBuf;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // CARGO_MANIFEST_DIR is `<repo>/open-pdf-studio/src-tauri`. The corpus
        // sits at `<repo>/test pdf-bestanden/Originele bestanden/`.
        let corpus = manifest_dir
            .ancestors()
            .nth(2)
            .unwrap()
            .join("test pdf-bestanden")
            .join("Originele bestanden");
        if !corpus.exists() {
            eprintln!("[skip] corpus dir missing at {:?}", corpus);
            return;
        }
        // Pick the smallest PDF deterministically.
        let mut pdfs: Vec<_> = std::fs::read_dir(&corpus).unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("pdf"))
            .collect();
        pdfs.sort_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(u64::MAX));
        let smallest = pdfs.first().expect("no pdfs in corpus").clone();

        let state = AppState { test_pdfs_dir: std::sync::Arc::new(corpus) };
        let args = serde_json::json!({
            "path": smallest.to_string_lossy(),
            "page_index": 0,
            "width": 200
        });
        let result = tool_screenshot_page(&state, &args).await.expect("render ok");
        assert_eq!(result["isError"], serde_json::Value::Bool(false));
        let text = result["content"][0]["text"].as_str().unwrap();
        let body: serde_json::Value = serde_json::from_str(text).unwrap();
        let b64 = body["png_base64"].as_str().unwrap();
        assert!(b64.starts_with("iVBORw0KGgo"), "expected png magic; got {}", &b64[..20]);
        assert!(body["width"].as_u64().unwrap() > 0);
    }
}
