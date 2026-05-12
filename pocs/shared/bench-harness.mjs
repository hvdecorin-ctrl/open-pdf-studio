// pocs/shared/bench-harness.mjs
//
// Gedeelde CDP-based bench harness voor het PoC programma.
// Verbindt met een draaiende Tauri dev app op CDP port 9222 en meet
// render timings voor de scenarios uit corpus.json.
//
// Vereiste setup vóór gebruik:
//   1. Tauri dev draait met: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   2. npm run tauri:dev (vanuit open-pdf-studio/)
//   3. App is geopend en de WebView is bereikbaar via http://localhost:9222
//
// Gebruik:
//   node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
//   node pocs/shared/bench-harness.mjs --fixture barn --scenario scroll_p1_to_p7
//
// Output: JSON op stdout met per-run timing + median/p95 stats.

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const corpus = JSON.parse(readFileSync(join(__dirname, 'corpus.json'), 'utf-8'));

// ─── arg parsing ──────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
if (!args.fixture || !args.scenario) {
  console.error('Usage: bench-harness.mjs --fixture <name> --scenario <name> [--runs <n>]');
  console.error(`Fixtures: ${corpus.fixtures.map(f => f.name).join(', ')}`);
  console.error(`Scenarios: ${corpus.scenarios.map(s => s.name).join(', ')}`);
  process.exit(2);
}

const fixture = corpus.fixtures.find(f => f.name === args.fixture);
const scenario = corpus.scenarios.find(s => s.name === args.scenario);
if (!fixture) { console.error(`Unknown fixture: ${args.fixture}`); process.exit(2); }
if (!scenario) { console.error(`Unknown scenario: ${args.scenario}`); process.exit(2); }

const pdfPath = join(PROJECT_ROOT, corpus.fixture_root, fixture.path);
const measuredRuns = args.runs ? parseInt(args.runs) : scenario.measured_runs;
const warmupRuns = scenario.warmup_runs;

// ─── connect ──────────────────────────────────────────────
async function main() {
  let browser;
  try {
    browser = await playwright.chromium.connectOverCDP('http://localhost:9222', {
      timeout: 10000,
    });
  } catch (e) {
    console.error(`FATAL: cannot connect to CDP on localhost:9222. Is tauri dev running with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222?`);
    console.error(`Underlying error: ${e.message}`);
    process.exit(3);
  }

  const page = browser.contexts()[0]?.pages()[0];
  if (!page) { console.error('No page in CDP context'); process.exit(3); }

  // Ensure clean state — close all existing tabs first
  await page.evaluate(async () => {
    try {
      const { state } = await import('/js/core/state.ts');
      const { closeTab } = await import('/js/ui/chrome/tabs.js');
      while (state.documents.length > 0) closeTab(0, true);
    } catch (e) { /* harmless if no docs */ }
  });
  await sleep(500);

  // Open the fixture
  const opened = await page.evaluate(async (path) => {
    try {
      await window.__TAURI__.core.invoke('allow_fs_scope', { path });
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDF } = await import('/js/pdf/loader.js');
      const { state } = await import('/js/core/state.ts');
      createTab(path);
      await loadPDF(path, state.activeDocumentIndex);
      return {
        ok: !!state.documents[0]?.pdfDoc,
        numPages: state.documents[0]?.pdfDoc?.numPages,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, pdfPath);

  if (!opened.ok) {
    console.error(`Failed to open fixture: ${JSON.stringify(opened)}`);
    process.exit(4);
  }

  // Wait briefly for the page to settle
  await sleep(1000);

  // ── Scenario dispatch ──
  let runs;
  switch (scenario.name) {
    case 'cold_open_p1':
      runs = await scenarioColdOpenP1(page, fixture, warmupRuns, measuredRuns);
      break;
    case 'scroll_p1_to_p7':
      runs = await scenarioScrollAll(page, fixture, warmupRuns, measuredRuns);
      break;
    case 'zoom_in_revisit':
      runs = await scenarioZoomRevisit(page, fixture, warmupRuns, measuredRuns);
      break;
    case 'scroll_back_revisit':
      runs = await scenarioScrollBackRevisit(page, fixture, warmupRuns, measuredRuns);
      break;
    default:
      console.error(`Unknown scenario: ${scenario.name}`);
      process.exit(2);
  }

  await browser.close();

  // ── Stats ──
  const measured = runs.slice(warmupRuns).map(r => r.totalMs);
  const sorted = [...measured].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const mean = measured.reduce((a, b) => a + b, 0) / measured.length;

  const result = {
    fixture: fixture.name,
    scenario: scenario.name,
    pdfPath: pdfPath.replace(PROJECT_ROOT + '\\', ''),
    runs: runs.map((r, i) => ({ run: i, warmup: i < warmupRuns, ...r })),
    stats: {
      n: measured.length,
      median_ms: round1(median),
      mean_ms: round1(mean),
      p95_ms: round1(p95),
      min_ms: round1(Math.min(...measured)),
      max_ms: round1(Math.max(...measured)),
    },
    expected_baseline_ms: fixture.expected_baseline_ms,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));
}

// ─── scenarios ────────────────────────────────────────────

async function scenarioColdOpenP1(page, fixture, warmup, measured) {
  // Cold render of page 0 at scale 1.0. Between runs, force cache clear.
  const runs = [];
  for (let i = 0; i < warmup + measured; i++) {
    // Clear caches between runs (so each is "cold")
    await page.evaluate(async () => {
      try {
        const m = await import('/js/pdf/page-bitmap-cache.js');
        m.clearAllBitmaps?.();
      } catch (e) { /* shrug */ }
    });
    await sleep(200);

    const t = await page.evaluate(async () => {
      const t0 = performance.now();
      const buf = await window.__TAURI__.core.invoke('render_pdf_page', {
        path: (await import('/js/core/state.ts')).state.documents[0].filePath,
        pageIndex: 0,
        scale: 1.0,
        rotation: 0,
      });
      const dt = performance.now() - t0;
      const view = new DataView(buf.buffer || buf);
      const w = view.getUint32(0, true);
      const h = view.getUint32(4, true);
      return { totalMs: dt, width: w, height: h };
    });
    runs.push(t);
  }
  return runs;
}

async function scenarioScrollAll(page, fixture, warmup, measured) {
  const runs = [];
  for (let i = 0; i < warmup + measured; i++) {
    const t = await page.evaluate(async (numPages) => {
      const t0 = performance.now();
      const path = (await import('/js/core/state.ts')).state.documents[0].filePath;
      for (let p = 0; p < numPages; p++) {
        await window.__TAURI__.core.invoke('render_pdf_page', { path, pageIndex: p, scale: 1.0, rotation: 0 });
      }
      return { totalMs: performance.now() - t0 };
    }, fixture.pages);
    runs.push(t);
  }
  return runs;
}

async function scenarioZoomRevisit(page, fixture, warmup, measured) {
  const runs = [];
  for (let i = 0; i < warmup + measured; i++) {
    const t = await page.evaluate(async () => {
      const path = (await import('/js/core/state.ts')).state.documents[0].filePath;
      // Render at 1.0 (priming)
      await window.__TAURI__.core.invoke('render_pdf_page', { path, pageIndex: 0, scale: 1.0, rotation: 0 });
      // Render at 1.5 (zoom in — measure THIS)
      const t1 = performance.now();
      await window.__TAURI__.core.invoke('render_pdf_page', { path, pageIndex: 0, scale: 1.5, rotation: 0 });
      const zoomIn = performance.now() - t1;
      // Render at 1.0 again (zoom out back to cached scale — measure THIS too)
      const t2 = performance.now();
      await window.__TAURI__.core.invoke('render_pdf_page', { path, pageIndex: 0, scale: 1.0, rotation: 0 });
      const zoomBack = performance.now() - t2;
      return { totalMs: zoomIn + zoomBack, zoomIn_ms: zoomIn, zoomBack_ms: zoomBack };
    });
    runs.push(t);
  }
  return runs;
}

async function scenarioScrollBackRevisit(page, fixture, warmup, measured) {
  const runs = [];
  for (let i = 0; i < warmup + measured; i++) {
    const t = await page.evaluate(async (numPages) => {
      const path = (await import('/js/core/state.ts')).state.documents[0].filePath;
      // Cold scroll (priming)
      for (let p = 0; p < numPages; p++) {
        await window.__TAURI__.core.invoke('render_pdf_page', { path, pageIndex: p, scale: 1.0, rotation: 0 });
      }
      // Warm scroll (measure THIS)
      const t0 = performance.now();
      for (let p = 0; p < numPages; p++) {
        await window.__TAURI__.core.invoke('render_pdf_page', { path, pageIndex: p, scale: 1.0, rotation: 0 });
      }
      return { totalMs: performance.now() - t0 };
    }, fixture.pages);
    runs.push(t);
  }
  return runs;
}

// ─── helpers ──────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function round1(n) { return Math.round(n * 10) / 10; }

main().catch(e => { console.error('FATAL:', e); process.exit(99); });
