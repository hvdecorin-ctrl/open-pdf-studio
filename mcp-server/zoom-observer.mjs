// Live CDP observer for the Tauri dev app.
//
// Streams console messages + periodic canvas/scroll state snapshots to a
// log file. Run in background mode while the user interacts with the app.
// Then `tail` the log to see what happened.
//
// Run:
//   node mcp-server/zoom-observer.mjs > /tmp/zoom-observer.log 2>&1 &
//
// Read latest 30 lines while user is interacting:
//   tail -30 /tmp/zoom-observer.log
//
// Stop:
//   pkill -f zoom-observer.mjs

import { createRequire } from 'module';
import http from 'http';

const require = createRequire(import.meta.url);
const { WebSocket } = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/ws');

const LOG_PATH = process.env.OBSERVER_LOG || 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/mcp-server/zoom-observer.log';
const SNAPSHOT_INTERVAL_MS = 250;
const RELEVANT_LOG_RE = /render|STALE|tile|zoom|gen|wheel|scale|cap/i;

import fs from 'fs';
const out = fs.createWriteStream(LOG_PATH, { flags: 'w' });

function log(line) {
  const ts = new Date().toISOString().slice(11, 23);
  out.write(`[${ts}] ${line}\n`);
  process.stdout.write(`[${ts}] ${line}\n`);
}

async function fetchJson(url) {
  return new Promise((r, j) => http.get(url, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => { try { r(JSON.parse(b)); } catch (e) { j(e); } });
  }).on('error', j));
}

async function connectCdp() {
  // Wait until CDP responds. The WebView may be down briefly during a
  // Tauri rebuild — retry every 2s with exponential ceiling.
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      const targets = await fetchJson('http://localhost:9222/json/list');
      const pt = targets.find(t => t.type === 'page');
      if (pt) return pt;
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
    if (attempt > 0 && attempt % 5 === 0) log(`CDP unreachable, retry ${attempt}...`);
  }
  throw new Error('CDP never came up');
}

async function runOneSession() {
  const pt = await connectCdp();
  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      if (RELEVANT_LOG_RE.test(args)) {
        log(`CONSOLE[${msg.params.type}] ${args}`);
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      log(`EXCEPTION: ${msg.params.exceptionDetails?.text || JSON.stringify(msg.params)}`);
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  await new Promise(r => ws.on('open', r));

  function send(method, params = {}) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expr) {
    const result = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  await send('Runtime.enable');
  log('CDP connected, Runtime enabled');

  let lastSnapshot = '';
  setInterval(async () => {
    try {
      const s = await evaluate(`(async () => {
        const stateMod = await import('/js/core/state.ts').catch(() => null);
        const doc = stateMod?.state?.documents?.[stateMod.state.activeDocumentIndex];
        const pdfCanvas = document.getElementById('pdf-canvas');
        const container = document.getElementById('pdf-container');
        const r = pdfCanvas?.getBoundingClientRect();
        // Tile is no longer a DOM canvas — read transient bitmap + region
        // metadata from the viewport singleton (set by bitmap-orchestrator).
        const vp = window.__pdfViewport || null;
        const tileBitmap = vp?.currentTile || null;
        const tileMeta = vp?.currentTileMeta || null;
        return {
          scale: doc?.scale,
          engine: stateMod?.state?.renderEngine,
          timing: stateMod?.state?.renderTiming,
          bw: pdfCanvas?.width,
          bh: pdfCanvas?.height,
          cssW: pdfCanvas?.style?.width,
          cssH: pdfCanvas?.style?.height,
          rectL: r ? Math.round(r.left) : null,
          rectT: r ? Math.round(r.top) : null,
          rectW: r ? Math.round(r.width) : null,
          rectH: r ? Math.round(r.height) : null,
          scrollL: container?.scrollLeft,
          scrollT: container?.scrollTop,
          tileActive: !!tileBitmap,
          tileBw: tileBitmap?.width ?? null,
          tileBh: tileBitmap?.height ?? null,
          tileMeta,
        };
      })()`);
      // Only log if something changed
      const sig = JSON.stringify(s);
      if (sig !== lastSnapshot) {
        lastSnapshot = sig;
        const parts = [`scale=${s.scale}`, `engine=${s.engine}`];
        if (s.timing) parts.push(`(${s.timing})`);
        parts.push(`buf=${s.bw}x${s.bh}`);
        parts.push(`css=${s.cssW}x${s.cssH}`);
        parts.push(`rect=(${s.rectL},${s.rectT}) ${s.rectW}x${s.rectH}`);
        parts.push(`scroll=(${s.scrollL},${s.scrollT})`);
        if (s.tileActive) {
          const m = s.tileMeta || {};
          parts.push(`TILE=${s.tileBw}x${s.tileBh} pt=(${m.regionXpt},${m.regionYpt}) ${m.regionWpt}x${m.regionHpt}pt z=${m.zoom}`);
        } else {
          parts.push(`tile=off`);
        }
        log('STATE: ' + parts.join(' '));
      }
    } catch (e) {
      // silently swallow probe errors (app may be reloading)
    }
  }, SNAPSHOT_INTERVAL_MS);

  // Keep alive — but listen for WebSocket close so we can reconnect.
  await new Promise((resolve) => {
    ws.on('close', () => {
      log('WebSocket closed (probably WebView reload); will reconnect');
      resolve();
    });
    ws.on('error', (e) => {
      log('WebSocket error: ' + (e?.message ?? e));
      resolve();
    });
  });
}

async function main() {
  log('zoom-observer starting (auto-reconnect mode)...');
  while (true) {
    try {
      await runOneSession();
    } catch (e) {
      log('Session error: ' + (e?.message ?? e));
    }
    log('Reconnecting in 2s...');
    await new Promise(r => setTimeout(r, 2000));
  }
}

main().catch(e => { log('FATAL: ' + (e?.message ?? e)); process.exit(1); });
