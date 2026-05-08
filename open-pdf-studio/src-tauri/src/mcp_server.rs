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

/// Standard JSON-RPC error codes used by this server. Only the codes
/// currently dispatched in handler bodies are warning-clean; the rest are
/// defined for use by tool handlers added in tasks 6-9.
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

/// Handle `tools/list`. Empty for now — tasks 6-9 will append their tool
/// descriptors here.
fn handle_tools_list() -> Value {
    json!({ "tools": [] })
}

/// Handle `tools/call`. No tools registered yet, so always returns
/// "method not found" with the requested tool name.
fn handle_tools_call(params: &Value) -> (i32, String) {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("<missing>");
    (
        jsonrpc_error::METHOD_NOT_FOUND,
        format!("method not found: {name}"),
    )
}

/// Axum POST handler for `/mcp`. Parses the JSON-RPC envelope and dispatches
/// on the `method` field.
async fn mcp_handler(
    State(_state): State<AppState>,
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
            let (code, msg) = handle_tools_call(params);
            rpc_error(id, code, msg)
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
    fn tools_list_starts_empty() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools must be an array");
        assert!(arr.is_empty());
    }
}
