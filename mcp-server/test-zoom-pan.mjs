// Complete zoom + pan test via CDP — measures real frame times
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, '..', 'open-pdf-studio', 'package.json'));
const { chromium } = require('playwright');

const PDF = String.raw`C:\3BM\50_projecten\3_3BM_bouwtechniek\3059 Woonhuis Benedenkerkseweg 87 Stolwijk\20_post_IN\01 27-03-2026 beginstukken\begane grond do 3 constructie verwerkt_50.pdf`;

(async () => {
  console.log('=== Zoom & Pan Performance Test ===\n');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) { console.log('❌ No page'); process.exit(1); }

  // 1. Open PDF
  console.log('1. Opening PDF...');
  await page.evaluate(async (p) => {
    await window.__TAURI__.core.invoke('allow_fs_scope', { path: p });
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    createTab(p);
    await loadPDF(p, state.activeDocumentIndex);
  }, PDF);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'zoom-pan-1-loaded.png' });
  console.log('   ✅ PDF loaded');

  // 2. Measure rapid zoom — 20 Ctrl+wheel events
  console.log('\n2. Rapid zoom IN (20 events, 30ms apart)...');
  const box = await page.locator('#pdf-canvas').first().boundingBox();
  const cx = (box?.x || 400) + 300;
  const cy = (box?.y || 300) + 200;

  const zoomInT0 = Date.now();
  for (let i = 0; i < 20; i++) {
    await page.evaluate(({ x, y }) => {
      document.querySelector('.main-view')?.dispatchEvent(new WheelEvent('wheel', {
        clientX: x, clientY: y, deltaY: -80, ctrlKey: true, bubbles: true, cancelable: true
      }));
    }, { x: cx, y: cy });
    await page.waitForTimeout(30);
  }
  // Wait for debounced render
  await page.waitForTimeout(500);
  const zoomInTime = Date.now() - zoomInT0;
  await page.screenshot({ path: 'zoom-pan-2-zoomed-in.png' });

  const scaleAfterZoomIn = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    return state.documents[state.activeDocumentIndex]?.scale;
  });
  console.log(`   Done in ${zoomInTime}ms, scale=${scaleAfterZoomIn?.toFixed(2)}`);

  // 3. Rapid zoom OUT
  console.log('\n3. Rapid zoom OUT (20 events, 30ms apart)...');
  const zoomOutT0 = Date.now();
  for (let i = 0; i < 20; i++) {
    await page.evaluate(({ x, y }) => {
      document.querySelector('.main-view')?.dispatchEvent(new WheelEvent('wheel', {
        clientX: x, clientY: y, deltaY: 80, ctrlKey: true, bubbles: true, cancelable: true
      }));
    }, { x: cx, y: cy });
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(500);
  const zoomOutTime = Date.now() - zoomOutT0;
  await page.screenshot({ path: 'zoom-pan-3-zoomed-out.png' });

  const scaleAfterZoomOut = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    return state.documents[state.activeDocumentIndex]?.scale;
  });
  console.log(`   Done in ${zoomOutTime}ms, scale=${scaleAfterZoomOut?.toFixed(2)}`);

  // 4. Pan test — scroll horizontally and vertically
  console.log('\n4. Pan test (scroll 500px right, 300px down)...');
  const panT0 = Date.now();
  await page.evaluate(() => {
    const container = document.getElementById('pdf-container');
    if (container) {
      container.scrollLeft += 500;
      container.scrollTop += 300;
    }
  });
  await page.waitForTimeout(200);
  const panTime = Date.now() - panT0;
  await page.screenshot({ path: 'zoom-pan-4-panned.png' });
  console.log(`   Done in ${panTime}ms`);

  // 5. Canvas memory check
  console.log('\n5. Canvas memory check...');
  const memCheck = await page.evaluate(() => {
    const c = document.getElementById('pdf-canvas');
    return {
      w: c?.width, h: c?.height,
      mb: c ? Math.round(c.width * c.height * 4 / 1024 / 1024) : 0,
      cssW: c?.style?.width, cssH: c?.style?.height,
    };
  });
  console.log(`   Canvas: ${memCheck.w}x${memCheck.h} (${memCheck.mb}MB), CSS: ${memCheck.cssW} x ${memCheck.cssH}`);

  // 6. Measure individual vector redraw speed
  console.log('\n6. Raw vector redraw speed (20 redraws)...');
  const redrawResult = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const vr = await import('/js/pdf/vector-renderer.js');
    const doc = state.documents[state.activeDocumentIndex];
    if (!doc || !vr.hasCachedCommands(doc.filePath, doc.currentPage)) return 'no vector cache';

    const canvas = document.getElementById('pdf-canvas');
    const vpW = canvas.width, vpH = canvas.height;
    const times = [];
    for (let i = 0; i < 20; i++) {
      const scale = 0.5 + i * 0.2;
      const t0 = performance.now();
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, vpW, vpH);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, vpW, vpH);
      vr.renderVectorPage(ctx, doc.filePath, doc.currentPage,
        { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 });
      times.push(Math.round(performance.now() - t0));
    }
    return { viewport: vpW + 'x' + vpH, times, avg: Math.round(times.reduce((a,b)=>a+b)/times.length), min: Math.min(...times), max: Math.max(...times) };
  });
  console.log(`   ${JSON.stringify(redrawResult)}`);

  // 7. Rapid zoom + measure frame-to-frame time
  console.log('\n7. Frame-to-frame timing (zoom with requestAnimationFrame)...');
  const frameTimes = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const vr = await import('/js/pdf/vector-renderer.js');
    const doc = state.documents[state.activeDocumentIndex];
    if (!doc || !vr.hasCachedCommands(doc.filePath, doc.currentPage)) return 'no cache';

    const canvas = document.getElementById('pdf-canvas');
    const vpW = canvas.width, vpH = canvas.height;
    const frameDurations = [];

    return new Promise(resolve => {
      let frame = 0;
      let lastTime = performance.now();
      function renderFrame() {
        if (frame >= 30) {
          resolve({ frameDurations, avg: Math.round(frameDurations.reduce((a,b)=>a+b)/frameDurations.length), fps: Math.round(1000 / (frameDurations.reduce((a,b)=>a+b)/frameDurations.length)) });
          return;
        }
        const now = performance.now();
        const scale = 1.0 + Math.sin(frame * 0.3) * 0.5; // Oscillating zoom
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, vpW, vpH);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, vpW, vpH);
        vr.renderVectorPage(ctx, doc.filePath, doc.currentPage,
          { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 });
        frameDurations.push(Math.round(now - lastTime));
        lastTime = now;
        frame++;
        requestAnimationFrame(renderFrame);
      }
      requestAnimationFrame(renderFrame);
    });
  });
  console.log(`   Avg frame: ${frameTimes.avg}ms, FPS: ${frameTimes.fps}`);
  console.log(`   Frame times: ${frameTimes.frameDurations?.join(', ')}`);

  console.log('\n=== Summary ===');
  console.log(`Zoom in (20 events):  ${zoomInTime}ms`);
  console.log(`Zoom out (20 events): ${zoomOutTime}ms`);
  console.log(`Pan (500px):          ${panTime}ms`);
  console.log(`Canvas memory:        ${memCheck.mb}MB`);
  console.log(`Vector redraw avg:    ${redrawResult.avg}ms`);
  console.log(`Frame rate:           ${frameTimes.fps} fps`);
  console.log('');
  await browser.close();
})();
