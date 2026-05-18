import { Show } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';
import { useTranslation, localizeNumber } from '../../i18n/useTranslation.js';

// All page navigation goes through goToPage() so the side effects
// (active thumbnail update, hide properties, fire events) happen in one
// place. Calling renderPage() directly would skip the thumbnail-active
// update and the highlight in the left panel would lag the actual page.

async function goFirst() {
  const { goToPage } = await import('../../pdf/renderer.js');
  const doc = getActiveDocument();
  if (doc?.pdfDoc && doc.currentPage !== 1) {
    await goToPage(1);
  }
}

async function goPrev() {
  const { goToPage } = await import('../../pdf/renderer.js');
  const doc = getActiveDocument();
  if (doc && doc.currentPage > 1) {
    await goToPage(doc.currentPage - 1);
  }
}

async function goNext() {
  const { goToPage } = await import('../../pdf/renderer.js');
  const doc = getActiveDocument();
  if (doc?.pdfDoc && doc.currentPage < doc.pdfDoc.numPages) {
    await goToPage(doc.currentPage + 1);
  }
}

async function goLast() {
  const { goToPage } = await import('../../pdf/renderer.js');
  const doc = getActiveDocument();
  if (doc?.pdfDoc && doc.currentPage !== doc.pdfDoc.numPages) {
    await goToPage(doc.pdfDoc.numPages);
  }
}

async function handlePageInput(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const pageNum = parseInt(e.target.value, 10);
  const doc = getActiveDocument();
  if (doc?.pdfDoc && pageNum >= 1 && pageNum <= doc.pdfDoc.numPages) {
    const { goToPage } = await import('../../pdf/renderer.js');
    await goToPage(pageNum);
  } else if (doc) {
    e.target.value = doc.currentPage;
  }
  e.target.blur();
}

async function handlePageBlur(e) {
  const doc = getActiveDocument();
  if (doc?.pdfDoc) {
    const pageNum = parseInt(e.target.value, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > doc.pdfDoc.numPages) {
      e.target.value = doc.currentPage;
    }
  }
}

async function handleZoomIn() {
  const { zoomIn } = await import('../../pdf/renderer.js');
  zoomIn();
}

async function handleZoomOut() {
  const { zoomOut } = await import('../../pdf/renderer.js');
  zoomOut();
}

async function handleZoomInput(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  let val = e.target.value.replace('%', '').trim();
  let pct = parseInt(val, 10);
  if (!isNaN(pct) && pct >= 10 && pct <= 500) {
    const doc = state.documents[state.activeDocumentIndex];
    if (doc) {
      // Vector viewport mode is the source of truth — setZoom() handles
      // the dispatch (viewport.setZoomAtPoint vs legacy doc.scale path).
      const { setZoom } = await import('../../pdf/renderer.js');
      await setZoom(pct / 100);
    }
  }
  e.target.blur();
}

async function handleZoomBlur(e) {
  let val = e.target.value.replace('%', '').trim();
  let pct = parseInt(val, 10);
  if (isNaN(pct) || pct < 10 || pct > 500) {
    const doc = state.documents[state.activeDocumentIndex];
    e.target.value = Math.round((doc ? doc.scale : 1.5) * 100) + '%';
  } else if (!e.target.value.includes('%')) {
    e.target.value = pct + '%';
  }
}

export default function StatusBar() {
  const { t } = useTranslation('statusbar');

  const toolName = () => {
    const key = `tools.${state.currentTool}`;
    const translated = t(key);
    return translated !== key ? translated : state.currentTool;
  };
  const currentPage = () => {
    const doc = state.documents[state.activeDocumentIndex];
    return doc ? doc.currentPage : 1;
  };
  const totalPages = () => {
    const doc = state.documents[state.activeDocumentIndex];
    return localizeNumber(doc?.pdfDoc?.numPages || 0);
  };
  const zoomText = () => {
    const doc = state.documents[state.activeDocumentIndex];
    return localizeNumber(Math.round((doc ? doc.scale : 1.5) * 100)) + '%';
  };
  const annotationText = () => {
    const annotations = state.documents[state.activeDocumentIndex]?.annotations || [];
    if ((state.documents[state.activeDocumentIndex]?.viewMode || 'single') === 'continuous') {
      return localizeNumber(annotations.length);
    }
    const pageCount = annotations.filter(a => a.page === (state.documents[state.activeDocumentIndex]?.currentPage || 1)).length;
    return t('annotationsCount', { count: pageCount, total: annotations.length });
  };

  return (
    <div class="status-bar">
      <div class="status-bar-left">
        <Show when={state.renderEngine}>
          <div class="status-item" title={`Render engine: ${state.renderEngine}${state.renderTiming ? '  |  ' + state.renderTiming : ''}`}>
            <span style={{
              "font-size": "11px",
              "padding": "1px 8px",
              "border-radius": "2px",
              "background": (() => {
                const e = state.renderEngine || '';
                if (e === 'ERROR' || e === 'UNSUPPORTED') return '#b22';
                // Engine-name → status chip color:
                //   • Raster (PDFium...) → blue — bitmap rendering via PDFium
                //   • Vector             → green — vector renderer (Rust extract + JS canvas)
                //   • UNSUPPORTED/ERROR  → red (handled above)
                //   • anything else      → gray fallback
                if (e.startsWith('Raster')) return '#2a5fa0';
                if (e === 'Vector') return '#2a8a3a';
                return '#666';
              })(),
              "color": "#fff",
              "font-weight": "bold",
              "letter-spacing": "0.3px",
            }}>
              {(() => {
                const ov = state.renderEngineOverride;
                if (ov === 'rust-skia') return 'Engine: Rust (alpha)';
                if (ov === 'pdfium') return 'Engine: PDFium';
                const e = state.renderEngine || '';
                if (e.startsWith('Raster')) return 'Engine: PDFium';
                if (e === 'Vector') return 'Engine: Vector';
                return e ? `Engine: ${e}` : 'Engine: ?';
              })()}
            </span>
          </div>
          <div class="status-separator"></div>
        </Show>
        <div class="status-item">
          <span class="status-item-label">{t('toolLabel')}</span>
          <span class="status-item-value">{toolName()}</span>
        </div>
        <div class="status-separator"></div>
        <div class="status-item">
          <span class="status-item-label">{t('annotationsLabel')}</span>
          <span class="status-item-value">{annotationText()}</span>
        </div>
      </div>

      <Show when={!!state.documents[state.activeDocumentIndex]?.pdfDoc}>
        <div class="status-bar-center">
          <button class="status-nav-btn" tabIndex={-1} title={t('firstPage')} onClick={goFirst}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7M18 19l-7-7 7-7"/>
            </svg>
          </button>

          <button class="status-nav-btn" tabIndex={-1} title={t('previousPage')} onClick={goPrev}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>

          <span class="status-page-info">
            {t('page')} <input type="number" class="status-page-input" tabIndex={-1} value={currentPage()} min="1" onKeyDown={handlePageInput} onBlur={handlePageBlur} /> / <span>{totalPages()}</span>
          </span>

          <button class="status-nav-btn" tabIndex={-1} title={t('nextPage')} onClick={goNext}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </button>

          <button class="status-nav-btn" tabIndex={-1} title={t('lastPage')} onClick={goLast}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M6 5l7 7-7 7"/>
            </svg>
          </button>

          <div class="status-zoom-controls">
            <button class="status-nav-btn" tabIndex={-1} title={t('zoomOut')} onClick={handleZoomOut}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
              </svg>
            </button>

            <input type="text" class="status-zoom-input" tabIndex={-1} value={zoomText()} onKeyDown={handleZoomInput} onBlur={handleZoomBlur} />

            <button class="status-nav-btn" tabIndex={-1} title={t('zoomIn')} onClick={handleZoomIn}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
            </button>
          </div>
        </div>
      </Show>

      <div class="status-bar-right">
        <div class="status-item">
          <Show when={state.statusMessageVisible}>
            {state.statusMessage}
          </Show>
        </div>
        <Show when={!!state.documents[state.activeDocumentIndex]?.pdfDoc}>
          <div class="status-separator"></div>
          <div
            class="status-item"
            title={`Canvas: ${
              (typeof document !== 'undefined' && document.getElementById('pdf-canvas'))
                ? `${document.getElementById('pdf-canvas').width}×${document.getElementById('pdf-canvas').height}px`
                : '?'
            }  |  DPR: ${typeof window !== 'undefined' ? window.devicePixelRatio : '?'}`}
          >
            <span style={{
              "font-size": "11px",
              "padding": "1px 8px",
              "border-radius": "2px",
              "background": (() => {
                const s = state.documents[state.activeDocumentIndex]?.scale || 1;
                if (s >= 4) return '#a23';      // very high zoom — likely slow
                if (s >= 2) return '#a72';      // high zoom
                return '#333';
              })(),
              "color": "#fff",
              "font-weight": "bold",
              "letter-spacing": "0.3px",
            }}>
              Zoom {localizeNumber(Math.round((state.documents[state.activeDocumentIndex]?.scale || 1) * 100))}%
            </span>
          </div>
        </Show>
        <Show when={state.renderEngine}>
          <div class="status-separator"></div>
          <div class="status-item" title={state.renderTiming || ''}>
            {/* Dropdown replaces the old cycle-on-click badge. Auto / PDFium
                (Raster) / Onze engine (Rust alpha). Triggers a re-render
                of the current page on change so the engine swap is visible
                immediately. */}
            <select
              value={state.renderEngineOverride ?? 'auto'}
              onChange={(e) => {
                const v = e.currentTarget.value;
                state.renderEngineOverride = (v === 'auto') ? null : v;
                try {
                  if (window.__pdfViewport) {
                    window.__pdfViewport.currentBitmap = null;
                    window.__pdfViewport.dirty = true;
                  }
                  import('../../pdf/renderer.js').then(m => {
                    const doc = state.documents[state.activeDocumentIndex];
                    if (doc?.currentPage) m.renderPage(doc.currentPage);
                  });
                } catch {}
              }}
              style={{
                "font-size": "10px",
                "padding": "1px 4px",
                "border-radius": "2px",
                "background": (() => {
                  const ov = state.renderEngineOverride;
                  if (ov === 'rust-skia') return '#a04a2a'; // orange for alpha
                  const e = state.renderEngine || '';
                  if (e.startsWith('Raster')) return '#2a5fa0';
                  if (e === 'Vector') return '#2a8a3a';
                  return '#666';
                })(),
                "color": "#fff",
                "font-weight": "bold",
                "letter-spacing": "0.3px",
                "border": "1px solid rgba(255,255,255,0.2)",
                "cursor": "pointer",
              }}>
              <option value="auto" style={{ background: '#222' }}>Engine: Auto</option>
              <option value="pdfium" style={{ background: '#222' }}>Engine: PDFium (Raster)</option>
              <option value="rust-skia" style={{ background: '#222' }}>Engine: Onze engine (alpha)</option>
            </select>
            <Show when={state.renderTiming}>
              <span style={{ "font-size": "10px", "margin-left": "4px", "opacity": "0.7" }}>
                {state.renderTiming}
              </span>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
