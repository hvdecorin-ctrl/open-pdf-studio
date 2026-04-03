// Test symbol placement via CDP on the running Tauri app
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const TEST_PDF = String.raw`C:\3BM\50_projecten\3_3BM_bouwtechniek\3059 Woonhuis Benedenkerkseweg 87 Stolwijk\20_post_IN\01 27-03-2026 beginstukken\begane grond do 3 constructie verwerkt_50.pdf`;

(async () => {
  console.log('=== Symbol Placement Test via CDP ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) { console.log('❌ No page'); process.exit(1); }
  console.log('1. ✅ Connected');

  // Open PDF first
  console.log('\n2. Opening PDF...');
  const openOk = await page.evaluate(async (path) => {
    try {
      await window.__TAURI__.core.invoke('allow_fs_scope', { path });
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDF } = await import('/js/pdf/loader.js');
      const { state } = await import('/js/core/state.ts');
      createTab(path);
      await loadPDF(path, state.activeDocumentIndex);
      await new Promise(r => setTimeout(r, 2000));
      return !!state.documents[state.activeDocumentIndex]?.pdfDoc;
    } catch (e) { return false; }
  }, TEST_PDF);
  console.log(openOk ? '   ✅ PDF opened' : '   ❌ PDF failed');
  if (!openOk) { await browser.close(); process.exit(1); }

  // Test 3: Select a symbol from the palette
  console.log('\n3. Selecting NEN1414 symbol...');
  const selectResult = await page.evaluate(async () => {
    try {
      const { state } = await import('/js/core/state.ts');
      const { setTool } = await import('/js/tools/manager.js');

      // Simulate what SymbolPalette.selectSymbol does
      // First set overrides, then switch tool (fixed race condition order)
      const testSvg = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="48" height="48" fill="none" stroke="#d00" stroke-width="3"/><text x="32" y="38" font-size="14" font-weight="bold" font-family="Arial" fill="#d00" text-anchor="middle">TEST</text></svg>';

      state.toolOverrides = {
        stampSvg: testSvg,
        stampName: 'Test Symbol',
        stampWidth: 40,
        stampHeight: 40,
        lockAspectRatio: true,
      };
      setTool('stamp');

      return {
        ok: true,
        tool: state.currentTool,
        hasOverrides: !!state.toolOverrides,
        hasSvg: !!state.toolOverrides?.stampSvg,
      };
    } catch (e) {
      return { ok: false, error: e.toString() };
    }
  });
  console.log('   Result:', JSON.stringify(selectResult));

  // Test 4: Simulate clicking on the canvas to place the symbol
  console.log('\n4. Placing symbol on canvas...');
  const placeResult = await page.evaluate(async () => {
    try {
      const { state } = await import('/js/core/state.ts');
      const stamps = await import('/js/annotations/stamps.js');

      // Place at center of page
      const doc = state.documents[state.activeDocumentIndex];
      if (!doc) return { ok: false, error: 'no doc' };

      const beforeCount = doc.annotations.length;
      await stamps.placeOverrideStamp(400, 300);
      const afterCount = doc.annotations.length;

      // Check if annotation was created
      const lastAnn = doc.annotations[doc.annotations.length - 1];
      return {
        ok: afterCount > beforeCount,
        annotationCreated: afterCount > beforeCount,
        beforeCount,
        afterCount,
        lastType: lastAnn?.type,
        lastImageId: lastAnn?.imageId,
        hasStampSvg: !!lastAnn?.stampSvg,
        width: lastAnn?.width,
        height: lastAnn?.height,
      };
    } catch (e) {
      return { ok: false, error: e.toString() };
    }
  });
  console.log('   Result:', JSON.stringify(placeResult, null, 2));

  // Test 5: Check if the symbol renders on canvas
  console.log('\n5. Checking canvas rendering...');
  await page.evaluate(async () => {
    const renderer = await import('/js/annotations/rendering.js');
    renderer.redrawAnnotations();
    await new Promise(r => setTimeout(r, 500));
  });

  const renderCheck = await page.evaluate(() => {
    const canvas = document.getElementById('annotation-canvas');
    if (!canvas) return { hasCanvas: false };
    const ctx = canvas.getContext('2d');
    // Sample around where we placed the stamp (400, 300 at current scale)
    const scale = 1.5; // default scale
    const sx = Math.floor(400 * scale);
    const sy = Math.floor(300 * scale);
    const data = ctx.getImageData(sx - 20, sy - 20, 40, 40).data;
    let nonTransparent = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) nonTransparent++;
    }
    return {
      hasCanvas: true,
      canvasW: canvas.width,
      canvasH: canvas.height,
      nonTransparentPixels: nonTransparent,
      totalSampled: data.length / 4,
      symbolVisible: nonTransparent > 10,
    };
  });
  console.log('   Result:', JSON.stringify(renderCheck));

  // Screenshot
  await page.screenshot({ path: 'test-symbols-result.png' });
  console.log('\n6. Screenshot: test-symbols-result.png');

  // Test 6: Check imageCache
  console.log('\n7. Checking imageCache...');
  const cacheCheck = await page.evaluate(async () => {
    const { imageCache } = await import('/js/core/state.ts');
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    const lastAnn = doc?.annotations[doc.annotations.length - 1];

    return {
      cacheSize: imageCache.size,
      lastAnnImageId: lastAnn?.imageId,
      imageInCache: lastAnn?.imageId ? imageCache.has(lastAnn.imageId) : false,
      imageComplete: lastAnn?.imageId ? imageCache.get(lastAnn.imageId)?.complete : null,
    };
  });
  console.log('   Result:', JSON.stringify(cacheCheck));

  console.log('\n=== Done ===');
  await browser.close();
})();
