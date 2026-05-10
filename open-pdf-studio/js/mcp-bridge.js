/**
 * MCP <-> WebView bridge.
 *
 * Listens for `mcp:*` events emitted by the Rust MCP server (see
 * `src-tauri/src/mcp_app_bridge.rs`) and dispatches them to the matching
 * in-app function. After each handler completes (or throws) we call
 * `app_response(requestId, result)` so the awaiting MCP tool returns.
 *
 * Expected event payload:
 *   { request_id: number, params: object }
 *
 * Handler return shapes:
 *   { ok: true, ... }       -> success, additional fields are tool-specific
 *   { ok: false, error: s } -> failure (the tool surface still gets a 200 OK)
 *
 * The MCP server side doesn't impose a specific response schema; whatever
 * JSON we send back ends up in the tool's `content[0].text` block verbatim.
 */

// All app-internal imports are resolved lazily inside handlers so the
// bridge module load never pulls the heavy renderer/loader graph at app
// startup. Keeps `initMcpBridge()` import-safe even if a downstream module
// is briefly broken in dev.

/** Best-effort grab of the Tauri invoke fn — falls back to a no-op so this
 *  module is import-safe in the browser/dev-server case. */
function tauriInvoke() {
  return window.__TAURI__?.core?.invoke ?? null;
}

/** Send the response payload back to the awaiting Rust task. */
async function respond(requestId, result) {
  const invoke = tauriInvoke();
  if (!invoke) return;
  try {
    await invoke('app_response', { requestId, result });
  } catch (e) {
    console.warn('[mcp-bridge] app_response failed:', e);
  }
}

/** Resolve once the active document has its PDF.js doc loaded (or `timeoutMs`
 *  elapses). loadPDF is fire-and-forget here because it goes through the
 *  app's own promise queue — we have to poll for the side effect. */
async function waitForActiveLoad(targetDoc, timeoutMs = 30000) {
  const stateMod = await import('./core/state.js');
  const t0 = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (!stateMod.state.documents.includes(targetDoc)) return resolve(false);
      if (targetDoc.pdfDoc && !targetDoc._isLoading) return resolve(true);
      if (performance.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(check, 50);
    };
    check();
  });
}

/** Composite the PDF canvas + annotation/highlight overlays into a single
 *  PNG and return it as a base64 string (no `data:` prefix).
 *
 *  We deliberately do NOT capture the surrounding chrome (toolbars, panels)
 *  — the regression-test harness only cares about the page view. For a
 *  full-window grab the caller can use OS-level screenshotting. */
async function compositeCurrentView(maxWidth = 2000) {
  const pdfCanvas = document.getElementById('pdf-canvas');
  const annCanvas = document.getElementById('annotation-canvas');
  const hlCanvas  = document.getElementById('text-highlight-canvas');
  if (!pdfCanvas || pdfCanvas.width === 0 || pdfCanvas.height === 0) {
    throw new Error('pdf-canvas not visible');
  }

  // Scale the composite so the longer side fits within maxWidth (avoids
  // multi-megabyte payloads on 4K displays at 800% zoom).
  const longest = Math.max(pdfCanvas.width, pdfCanvas.height);
  const scale = longest > maxWidth ? maxWidth / longest : 1;
  const outW = Math.max(1, Math.round(pdfCanvas.width * scale));
  const outH = Math.max(1, Math.round(pdfCanvas.height * scale));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  // White background so transparent regions don't read as black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(pdfCanvas, 0, 0, outW, outH);
  if (hlCanvas && hlCanvas.width > 0 && hlCanvas.height > 0) {
    ctx.drawImage(hlCanvas, 0, 0, outW, outH);
  }
  if (annCanvas && annCanvas.width > 0 && annCanvas.height > 0) {
    ctx.drawImage(annCanvas, 0, 0, outW, outH);
  }
  const dataURL = out.toDataURL('image/png');
  // Strip the `data:image/png;base64,` prefix so the returned string is
  // pure base64 (matches the existing `screenshot_page` tool's shape).
  const b64 = dataURL.startsWith('data:') ? dataURL.split(',', 2)[1] : dataURL;
  return { png_base64: b64, width: outW, height: outH };
}

// ─── Per-event handlers ─────────────────────────────────────────────────

async function handleOpenPdf(params) {
  const path = params?.path;
  if (typeof path !== 'string' || !path) {
    return { ok: false, error: 'missing or invalid params.path' };
  }
  const stateMod = await import('./core/state.js');
  const tabsMod = await import('./ui/chrome/tabs.js');
  const loaderMod = await import('./pdf/loader.js');

  // Reuse existing tab if the file is already open.
  let tabIndex = stateMod.findDocumentByPath(path);
  if (tabIndex === -1) {
    const { index } = tabsMod.createTab(path, false);
    tabIndex = index;
  }
  tabsMod.switchToTab(tabIndex);
  const doc = stateMod.state.documents[tabIndex];
  if (!doc.pdfDoc) {
    try {
      await loaderMod.loadPDF(path, tabIndex);
    } catch (e) {
      return { ok: false, error: `loadPDF: ${e?.message ?? e}` };
    }
  }
  const ready = await waitForActiveLoad(doc, 30000);
  if (!ready) return { ok: false, error: 'load timed out' };
  return {
    ok: true,
    tab_id:     tabIndex,
    page_count: doc.pdfDoc?.numPages ?? 0,
    file_path:  path,
  };
}

async function handleSetZoom(params) {
  const scale = Number(params?.scale);
  if (!Number.isFinite(scale) || scale <= 0) {
    return { ok: false, error: 'missing or invalid params.scale' };
  }
  const rendererMod = await import('./pdf/renderer.js');
  const stateMod = await import('./core/state.js');
  try {
    await rendererMod.setZoom(scale);
  } catch (e) {
    return { ok: false, error: `setZoom: ${e?.message ?? e}` };
  }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, requested: scale, actual };
}

async function handleZoomIn() {
  const rendererMod = await import('./pdf/renderer.js');
  const stateMod = await import('./core/state.js');
  try { await rendererMod.zoomIn(); } catch (e) { return { ok: false, error: `zoomIn: ${e?.message ?? e}` }; }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, actual };
}

async function handleZoomOut() {
  const rendererMod = await import('./pdf/renderer.js');
  const stateMod = await import('./core/state.js');
  try { await rendererMod.zoomOut(); } catch (e) { return { ok: false, error: `zoomOut: ${e?.message ?? e}` }; }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, actual };
}

async function handleScreenshotView(params) {
  const width = Number(params?.width) > 0 ? Number(params.width) : 2000;
  // Yield one frame so any pending zoom / paint has a chance to land.
  await new Promise((r) => requestAnimationFrame(() => r()));
  await new Promise((r) => requestAnimationFrame(() => r()));
  try {
    const out = await compositeCurrentView(width);
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: `compositeCurrentView: ${e?.message ?? e}` };
  }
}

const HANDLERS = {
  'mcp:open-pdf':        handleOpenPdf,
  'mcp:set-zoom':        handleSetZoom,
  'mcp:zoom-in':         handleZoomIn,
  'mcp:zoom-out':        handleZoomOut,
  'mcp:screenshot-view': handleScreenshotView,
};

/** Wire up all `mcp:*` listeners. Safe to call once at startup. Becomes
 *  a no-op when Tauri isn't present (browser dev mode). */
export async function initMcpBridge() {
  if (!window.__TAURI__?.core?.invoke) {
    // Definitely not in Tauri.
    return;
  }

  // Resolve the event API. Prefer the global, fall back to the npm
  // module so we still work if `withGlobalTauri` is ever turned off.
  let ev = window.__TAURI__?.event;
  if (!ev) {
    try {
      ev = await import('@tauri-apps/api/event');
    } catch (e) {
      console.warn('[mcp-bridge] event API unavailable:', e);
      return;
    }
  }

  const wired = [];
  for (const [name, handler] of Object.entries(HANDLERS)) {
    try {
      await ev.listen(name, async (event) => {
        const payload = event?.payload ?? {};
        const requestId = payload.request_id;
        const params = payload.params ?? {};
        if (typeof requestId !== 'number') {
          console.warn('[mcp-bridge] missing request_id in', name, payload);
          return;
        }
        let result;
        try {
          result = await handler(params);
        } catch (e) {
          console.warn('[mcp-bridge] handler threw for', name, e);
          result = { ok: false, error: `${e?.message ?? e}` };
        }
        await respond(requestId, result);
      });
      wired.push(name);
    } catch (e) {
      console.warn('[mcp-bridge] listen failed for', name, e);
    }
  }
  window.__mcpBridgeReady = true;
  window.__mcpBridgeEvents = wired;
  console.log('[mcp-bridge] ready, events:', wired);
  // Notify the Rust side so we can confirm wire-up from outside the WebView
  // (devtools console isn't visible when launched headless).
  try {
    await window.__TAURI__.core.invoke('mcp_bridge_ready', { events: wired });
  } catch {
    /* harmless when running against an older binary without the cmd */
  }
}
