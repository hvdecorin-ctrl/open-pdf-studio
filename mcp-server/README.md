# Open PDF Studio — Testing MCP Server

CDP-based test tools for automating the Tauri desktop app.

## Prerequisites

1. Start the app with CDP enabled:
   ```bash
   export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
   cd open-pdf-studio && npm run tauri:dev
   ```

2. Install Playwright: `cd open-pdf-studio && npm install playwright`

## Test Scripts

| Script | Description |
|--------|-------------|
| `test-tauri-cdp.mjs` | Full E2E test: open PDF, render, zoom, screenshot |
| `test-symbols-cdp.mjs` | Symbol placement test |
| `test-real-pdf.mjs` | MuPDF WASM rendering test (browser-only) |

## Usage

```bash
cd open-pdf-studio
node mcp-server/test-tauri-cdp.mjs
```
