// pocs/shared/bench-raw-cdp.mjs — raw-CDP bench harness (no Playwright)
//
// Playwright's connectOverCDP asserts on shared_worker targets, which can
// orphan after Tauri rebuilds. This bypasses Playwright entirely and talks
// to the page WebSocket directly. Same scenarios as bench-harness.mjs.
//
// Setup:
//   - Tauri dev with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//
// Usage:
//   node pocs/shared/bench-raw-cdp.mjs --fixture barn --scenario cold_open_p1

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';

const require = createRequire(import.meta.url);
const { WebSocket } = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/ws');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const corpus = JSON.parse(readFileSync(join(__dirname, 'corpus.json'), 'utf-8'));

const args = parseArgs(process.argv.slice(2));
if (!args.fixture || !args.scenario) {
  console.error('Usage: bench-raw-cdp.mjs --fixture <name> --scenario <name>');
  process.exit(2);
}

const fixture = corpus.fixtures.find(f => f.name === args.fixture);
const scenario = corpus.scenarios.find(s => s.name === args.scenario);
if (!fixture || !scenario) { console.error(`Unknown fixture/scenario`); process.exit(2); }

const pdfPath = join(PROJECT_ROOT, corpus.fixture_root, fixture.path);
const measuredRuns = args.runs ? parseInt(args.runs) : scenario.measured_runs;
const warmupRuns = scenario.warmup_runs;

async function main() {
  // Step 1: discover page target
  const targets = await fetchJson('http://localhost:9222/json/list');
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) { console.error('No page target'); process.exit(3); }

  // Step 2: connect raw WebSocket
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  await new Promise((r) => ws.on('open', r));

  function send(method, params = {}) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expr, awaitPromise = true) {
    const result = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  // Step 3: grant FS scope
  const escapedPath = JSON.stringify(pdfPath);
  await evaluate(`window.__TAURI__.core.invoke('allow_fs_scope', { path: ${escapedPath} })`);

  // Step 4: scenarios
  let runs;
  switch (scenario.name) {
    case 'cold_open_p1':       runs = await scenarioColdOpenP1(evaluate, escapedPath); break;
    case 'scroll_p1_to_p7':    runs = await scenarioScrollAll(evaluate, escapedPath, fixture.pages); break;
    case 'zoom_in_revisit':    runs = await scenarioZoomRevisit(evaluate, escapedPath); break;
    case 'scroll_back_revisit':runs = await scenarioScrollBackRevisit(evaluate, escapedPath, fixture.pages); break;
    default: console.error(`Unknown scenario: ${scenario.name}`); process.exit(2);
  }

  ws.close();

  const measured = runs.slice(warmupRuns).map(r => r.totalMs);
  const sorted = [...measured].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const mean = measured.reduce((a, b) => a + b, 0) / measured.length;

  console.log(JSON.stringify({
    fixture: fixture.name,
    scenario: scenario.name,
    runs: runs.map((r, i) => ({ run: i, warmup: i < warmupRuns, ...r })),
    stats: {
      n: measured.length,
      median_ms: round1(median),
      mean_ms: round1(mean),
      p95_ms: round1(p95),
      min_ms: round1(Math.min(...measured)),
      max_ms: round1(Math.max(...measured)),
    },
    timestamp: new Date().toISOString(),
  }, null, 2));
}

async function scenarioColdOpenP1(evaluate, escapedPath) {
  const runs = [];
  for (let i = 0; i < warmupRuns + measuredRuns; i++) {
    await evaluate(`window.__TAURI__.core.invoke('clear_pdf_cache', { path: ${escapedPath} }).catch(()=>null)`);
    await new Promise(r => setTimeout(r, 200));
    const t = await evaluate(`(async () => {
      const t0 = performance.now();
      const buf = await window.__TAURI__.core.invoke('render_pdf_page', {
        path: ${escapedPath}, pageIndex: 0, scale: 1.0, rotation: 0,
      });
      const dt = performance.now() - t0;
      const view = new DataView(buf.buffer || buf);
      return { totalMs: dt, width: view.getUint32(0, true), height: view.getUint32(4, true) };
    })()`);
    runs.push(t);
  }
  return runs;
}

async function scenarioScrollAll(evaluate, escapedPath, numPages) {
  const runs = [];
  for (let i = 0; i < warmupRuns + measuredRuns; i++) {
    const t = await evaluate(`(async () => {
      const t0 = performance.now();
      for (let pn = 0; pn < ${numPages}; pn++) {
        await window.__TAURI__.core.invoke('render_pdf_page', { path: ${escapedPath}, pageIndex: pn, scale: 1.0, rotation: 0 });
      }
      return { totalMs: performance.now() - t0 };
    })()`);
    runs.push(t);
  }
  return runs;
}

async function scenarioZoomRevisit(evaluate, escapedPath) {
  const runs = [];
  for (let i = 0; i < warmupRuns + measuredRuns; i++) {
    const t = await evaluate(`(async () => {
      await window.__TAURI__.core.invoke('render_pdf_page', { path: ${escapedPath}, pageIndex: 0, scale: 1.0, rotation: 0 });
      const t1 = performance.now();
      await window.__TAURI__.core.invoke('render_pdf_page', { path: ${escapedPath}, pageIndex: 0, scale: 1.5, rotation: 0 });
      const zoomIn = performance.now() - t1;
      const t2 = performance.now();
      await window.__TAURI__.core.invoke('render_pdf_page', { path: ${escapedPath}, pageIndex: 0, scale: 1.0, rotation: 0 });
      const zoomBack = performance.now() - t2;
      return { totalMs: zoomIn + zoomBack, zoomIn_ms: zoomIn, zoomBack_ms: zoomBack };
    })()`);
    runs.push(t);
  }
  return runs;
}

async function scenarioScrollBackRevisit(evaluate, escapedPath, numPages) {
  const runs = [];
  for (let i = 0; i < warmupRuns + measuredRuns; i++) {
    const t = await evaluate(`(async () => {
      for (let pn = 0; pn < ${numPages}; pn++) {
        await window.__TAURI__.core.invoke('render_pdf_page', { path: ${escapedPath}, pageIndex: pn, scale: 1.0, rotation: 0 });
      }
      const t0 = performance.now();
      for (let pn = 0; pn < ${numPages}; pn++) {
        await window.__TAURI__.core.invoke('render_pdf_page', { path: ${escapedPath}, pageIndex: pn, scale: 1.0, rotation: 0 });
      }
      return { totalMs: performance.now() - t0 };
    })()`);
    runs.push(t);
  }
  return runs;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

function round1(n) { return Math.round(n * 10) / 10; }

main().catch(e => { console.error('FATAL:', e); process.exit(99); });
