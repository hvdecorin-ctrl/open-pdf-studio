import { createSignal, Show } from 'solid-js';
import { useTranslation } from '../i18n/useTranslation.js';
import { state } from '../core/state.js';
import { openFileDialog } from '../core/platform.js';
import { loadPDF } from '../pdf/loader.js';
import { createTab } from '../ui/chrome/tabs.js';
import { initDomElements } from '../ui/dom-elements.js';
import LoadingOverlay from './components/LoadingOverlay.jsx';

export default function MobileApp() {
  const { t } = useTranslation('common');
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [toolsOpen, setToolsOpen] = createSignal(false);

  const hasDocument = () => state.documents && state.documents.length > 0;
  const currentDoc = () => hasDocument() ? state.documents[state.activeDocumentIndex] : null;
  const fileName = () => {
    const doc = currentDoc();
    if (!doc || !doc.filePath) return t('appName') || 'Open PDF Studio';
    const parts = doc.filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1];
  };

  async function handleOpen() {
    setDrawerOpen(false);
    try {
      const path = await openFileDialog();
      if (path) {
        createTab(path);
        // Re-init DOM elements after Solid renders the canvas (deferred via microtask)
        await new Promise(r => setTimeout(r, 0));
        initDomElements();
        await loadPDF(path);
      }
    } catch (e) {
      console.warn('Failed to open file:', e);
    }
  }

  function handlePrevPage() {
    if (!hasDocument()) return;
    const doc = currentDoc();
    if (doc && state.currentPage > 1) {
      window.dispatchEvent(new CustomEvent('navigate-page', { detail: { page: state.currentPage - 1 } }));
    }
  }

  function handleNextPage() {
    if (!hasDocument()) return;
    const doc = currentDoc();
    if (doc && state.currentPage < state.totalPages) {
      window.dispatchEvent(new CustomEvent('navigate-page', { detail: { page: state.currentPage + 1 } }));
    }
  }

  function handleZoomIn() {
    window.dispatchEvent(new CustomEvent('zoom-change', { detail: { direction: 'in' } }));
  }

  function handleZoomOut() {
    window.dispatchEvent(new CustomEvent('zoom-change', { detail: { direction: 'out' } }));
  }

  function handleSave() {
    setDrawerOpen(false);
    window.dispatchEvent(new CustomEvent('save-document'));
  }

  function handleSaveAs() {
    setDrawerOpen(false);
    window.dispatchEvent(new CustomEvent('save-document-as'));
  }

  function handlePrint() {
    setDrawerOpen(false);
    window.dispatchEvent(new CustomEvent('print-document'));
  }

  return (
    <div class="mobile-app">
      {/* Top bar */}
      <div class="mobile-topbar">
        <button class="mobile-topbar-btn" onClick={() => setDrawerOpen(true)} aria-label="Menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span class="mobile-topbar-title">{fileName()}</span>
        <button class="mobile-topbar-btn" onClick={handleOpen} aria-label="Open file">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
        </button>
      </div>

      {/* Main PDF view */}
      <div class="mobile-main">
        <Show when={!hasDocument()}>
          <div class="mobile-placeholder">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="64" height="64">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <p>{t('noDocumentsHint') || 'Open a PDF file to get started'}</p>
            <button class="mobile-open-btn" onClick={handleOpen}>
              {t('openFile') || 'Open File'}
            </button>
          </div>
        </Show>

        <div id="placeholder" style="display:none"></div>
        <div id="pdf-container" class="mobile-pdf-container" classList={{ visible: hasDocument() }}>
          <div id="canvas-wrapper">
            <div id="canvas-container" class="single-page-container">
              <canvas id="pdf-canvas"></canvas>
              <canvas id="annotation-canvas"></canvas>
            </div>
            <div id="continuous-container" class="continuous-container"></div>
          </div>
        </div>
      </div>

      {/* Bottom toolbar */}
      <Show when={hasDocument()}>
        <div class="mobile-bottombar">
          <button class="mobile-toolbar-btn" onClick={handlePrevPage} disabled={state.currentPage <= 1} aria-label="Previous page">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <span class="mobile-page-info">
            {state.currentPage} / {state.totalPages}
          </span>

          <button class="mobile-toolbar-btn" onClick={handleNextPage} disabled={state.currentPage >= state.totalPages} aria-label="Next page">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>

          <div class="mobile-toolbar-separator"></div>

          <button class="mobile-toolbar-btn" onClick={handleZoomOut} aria-label="Zoom out">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          <button class="mobile-toolbar-btn" onClick={handleZoomIn} aria-label="Zoom in">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          <div class="mobile-toolbar-separator"></div>

          <button class="mobile-toolbar-btn" onClick={() => setToolsOpen(!toolsOpen())} aria-label="Annotation tools">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </div>
      </Show>

      {/* Annotation tools dropdown */}
      <Show when={toolsOpen()}>
        <div class="mobile-tools-overlay" onClick={() => setToolsOpen(false)}>
          <div class="mobile-tools-menu" onClick={(e) => e.stopPropagation()}>
            <button class="mobile-tools-item" onClick={() => { window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'highlight' } })); setToolsOpen(false); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="10" width="18" height="6" rx="1" /></svg>
              <span>{t('highlight') || 'Highlight'}</span>
            </button>
            <button class="mobile-tools-item" onClick={() => { window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'underline' } })); setToolsOpen(false); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v7a6 6 0 006 6 6 6 0 006-6V3" /><line x1="4" y1="21" x2="20" y2="21" /></svg>
              <span>{t('underline') || 'Underline'}</span>
            </button>
            <button class="mobile-tools-item" onClick={() => { window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'strikethrough' } })); setToolsOpen(false); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="12" x2="20" y2="12" /><path d="M6 20V4" /></svg>
              <span>{t('strikethrough') || 'Strikethrough'}</span>
            </button>
            <button class="mobile-tools-item" onClick={() => { window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'freehand' } })); setToolsOpen(false); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /></svg>
              <span>{t('freehand') || 'Freehand'}</span>
            </button>
            <button class="mobile-tools-item" onClick={() => { window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'text' } })); setToolsOpen(false); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>
              <span>{t('textAnnotation') || 'Text'}</span>
            </button>
          </div>
        </div>
      </Show>

      {/* Slide-out drawer */}
      <div class="mobile-drawer-overlay" classList={{ open: drawerOpen() }} onClick={() => setDrawerOpen(false)}>
        <div class="mobile-drawer" classList={{ open: drawerOpen() }} onClick={(e) => e.stopPropagation()}>
          <div class="mobile-drawer-header">
            <span>Open PDF Studio</span>
            <button class="mobile-drawer-close" onClick={() => setDrawerOpen(false)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="mobile-drawer-items">
            <button class="mobile-drawer-item" onClick={handleOpen}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              <span>{t('openFile') || 'Open'}</span>
            </button>
            <Show when={hasDocument()}>
              <button class="mobile-drawer-item" onClick={handleSave}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                <span>{t('save') || 'Save'}</span>
              </button>
              <button class="mobile-drawer-item" onClick={handleSaveAs}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                <span>{t('saveAs') || 'Save As'}</span>
              </button>
              <button class="mobile-drawer-item" onClick={handlePrint}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                <span>{t('print') || 'Print'}</span>
              </button>
            </Show>
            <div class="mobile-drawer-divider"></div>
            <button class="mobile-drawer-item" onClick={() => { setDrawerOpen(false); window.dispatchEvent(new CustomEvent('show-about')); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>{t('about') || 'About'}</span>
            </button>
          </div>
        </div>
      </div>

      <LoadingOverlay />
    </div>
  );
}
