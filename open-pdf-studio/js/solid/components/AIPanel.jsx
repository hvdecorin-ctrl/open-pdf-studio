import { Show, For, createSignal, createEffect, onMount } from 'solid-js';
import {
  aiPanelVisible, setAiPanelVisible,
  messages, isLoading, streamingContent,
  sendChat, sendAction, clearChat, usage, subscription,
  logout, isAuthenticated, user, online
} from '../stores/aiStore.js';
import { openDialog } from '../stores/dialogStore.js';
import { getActiveDocument } from '../../core/state.js';
import { getSelectedText } from '../../text/text-selection.js';
import { renderMarkdown } from '../../services/mini-markdown.js';
import { InputHistory } from '../../services/input-history.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const inputHistory = new InputHistory({ maxSize: 100 });
inputHistory.init();

// ── Persist helpers ──
function loadPanelState() {
  try {
    return JSON.parse(localStorage.getItem('ai_panel_state') || 'null');
  } catch { return null; }
}
function savePanelState(state) {
  localStorage.setItem('ai_panel_state', JSON.stringify(state));
}

// ── Text extraction ──
async function extractPageText(pageNum) {
  const doc = getActiveDocument();
  if (!doc || !doc.pdfDoc) return '';
  const page = await doc.pdfDoc.getPage(pageNum || doc.currentPage);
  const tc = await page.getTextContent();
  return tc.items.map(i => i.str).join(' ');
}

async function extractAllText() {
  const doc = getActiveDocument();
  if (!doc || !doc.pdfDoc) return '';
  const n = Math.min(doc.pdfDoc.numPages, 20);
  const parts = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.pdfDoc.getPage(i);
    const tc = await page.getTextContent();
    parts.push(`[Page ${i}]\n${tc.items.map(item => item.str).join(' ')}`);
  }
  return parts.join('\n\n');
}

async function getContextText(context) {
  if (context === 'selection') {
    const sel = getSelectedText();
    return sel || '';
  }
  if (context === 'all') return extractAllText();
  return extractPageText();
}

function getFileMeta() {
  const doc = getActiveDocument();
  if (!doc || !doc.pdfDoc) return {};
  return {
    file_name: doc.fileName || undefined,
    page_count: doc.pdfDoc.numPages || undefined,
    current_page: doc.currentPage || undefined,
  };
}

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

export default function AIPanel() {
  const { t } = useTranslation('ribbon');

  // ── Panel state ──
  const [mode, setMode] = createSignal('floating'); // 'floating' | 'docked'
  const [minimized, setMinimized] = createSignal(false);
  const [panelPos, setPanelPos] = createSignal({ x: null, y: null });
  const [panelSize, setPanelSize] = createSignal({ w: 380, h: 520 });
  const [context, setContext] = createSignal('page'); // 'page' | 'all' | 'selection'
  const [input, setInput] = createSignal('');

  let panelRef, messagesEnd, textareaRef;

  // ── Load persisted state ──
  onMount(() => {
    const saved = loadPanelState();
    if (saved) {
      if (saved.mode) setMode(saved.mode);
      if (saved.pos) setPanelPos(saved.pos);
      if (saved.size) setPanelSize(saved.size);
      if (saved.context) setContext(saved.context);
    }
  });

  function persist() {
    savePanelState({
      mode: mode(),
      pos: panelPos(),
      size: panelSize(),
      context: context(),
    });
  }

  // ── Auto scroll ──
  createEffect(() => {
    if (messages().length || streamingContent()) {
      messagesEnd?.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // ── Dragging ──
  function startDrag(e) {
    if (e.target.closest('button') || e.target.closest('select') || mode() === 'docked') return;
    const rect = panelRef.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    function onMove(ev) {
      setPanelPos({
        x: Math.max(0, Math.min(ev.clientX - ox, window.innerWidth - 100)),
        y: Math.max(0, Math.min(ev.clientY - oy, window.innerHeight - 50)),
      });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persist();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Resizing ──
  function startResize(e, dirX, dirY) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = panelSize().w, startH = panelSize().h;
    const startLeft = panelRef.getBoundingClientRect().left;
    const startTop = panelRef.getBoundingClientRect().top;

    function onMove(ev) {
      let w = startW, h = startH;
      if (dirX === 1) w = Math.max(300, startW + (ev.clientX - startX));
      if (dirX === -1) {
        w = Math.max(300, startW - (ev.clientX - startX));
        setPanelPos(prev => ({ ...prev, x: startLeft + (ev.clientX - startX) }));
      }
      if (dirY === 1) h = Math.max(300, startH + (ev.clientY - startY));
      if (dirY === -1) {
        h = Math.max(300, startH - (ev.clientY - startY));
        setPanelPos(prev => ({ ...prev, y: startTop + (ev.clientY - startY) }));
      }
      setPanelSize({ w, h });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persist();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Pin / Unpin ──
  function toggleDock() {
    if (mode() === 'docked') {
      setMode('floating');
      setPanelPos({ x: window.innerWidth - 400, y: 100 });
    } else {
      setMode('docked');
      setPanelPos({ x: null, y: null });
    }
    persist();
  }

  // ── Send ──
  async function handleSend() {
    const text = input().trim();
    if (!text || isLoading()) return;

    inputHistory.push(text);
    setInput('');
    if (textareaRef) textareaRef.style.height = 'auto';

    try {
      const doc = getActiveDocument();
      const meta = getFileMeta();
      if (doc && doc.pdfDoc) {
        const ctxText = await getContextText(context());
        if (ctxText) {
          await sendAction('qa', ctxText, { question: text, ...meta });
          return;
        }
      }
      await sendChat(text);
    } catch { /* error shown in chat */ }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey) {
      // Only navigate history when cursor is at the start or input is single-line
      const ta = e.target;
      if (ta.selectionStart === 0 || !input().includes('\n')) {
        const prev = inputHistory.navigateUp(input());
        if (prev !== undefined) {
          e.preventDefault();
          setInput(prev);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = 0; });
        }
      }
      return;
    }

    if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey) {
      const ta = e.target;
      if (ta.selectionStart === input().length || !input().includes('\n')) {
        if (inputHistory.isNavigating) {
          const next = inputHistory.navigateDown();
          if (next !== undefined) {
            e.preventDefault();
            setInput(next);
            requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = next.length; });
          }
        }
      }
      return;
    }

    if (e.key === 'Escape' && inputHistory.isNavigating) {
      e.preventDefault();
      const draft = inputHistory.cancel();
      setInput(draft);
      return;
    }
  }

  function autoGrow(e) {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  }

  // ── Quick actions ──
  async function quickAction(action) {
    try {
      const text = await getContextText(context());
      const meta = getFileMeta();
      if (text) await sendAction(action, text, meta);
    } catch { /* error in chat */ }
  }

  // ── Copy message ──
  function copyMessage(content) {
    navigator.clipboard.writeText(content).catch(() => {});
  }

  // ── Styles ──
  function panelStyle() {
    if (mode() === 'docked') {
      return {
        position: 'relative',
        width: panelSize().w + 'px',
        height: '100%',
        top: 'auto',
        right: 'auto',
        left: 'auto',
      };
    }
    return {
      position: 'fixed',
      width: panelSize().w + 'px',
      height: minimized() ? 'auto' : panelSize().h + 'px',
      ...(panelPos().x != null ? { left: panelPos().x + 'px', top: panelPos().y + 'px', right: 'auto' } : { right: '8px', top: '100px' }),
    };
  }

  return (
    <Show when={aiPanelVisible() && isAuthenticated()}>
      <div class={`ai-panel ${mode() === 'docked' ? 'ai-panel-docked' : 'ai-panel-floating'}`}
        ref={panelRef}
        style={panelStyle()}>

        {/* ── Header ── */}
        <div class="ai-panel-header" onMouseDown={startDrag}>
          <span class="ai-panel-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/>
              <circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M9 17h6"/>
            </svg>
            {' '}{t('ai.assistant') || 'AI Assistant'}
          </span>
          <div class="ai-panel-header-actions">
            {/* Pin/Unpin */}
            <button class="ai-panel-btn-icon" title={mode() === 'docked' ? 'Unpin' : 'Pin to side'}
              onClick={toggleDock}>
              <svg viewBox="0 0 24 24" fill={mode() === 'docked' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" width="12" height="12">
                <path d="M12 2l3 9h9l-7 5 3 9-8-6-8 6 3-9-7-5h9z"/>
              </svg>
            </button>
            {/* Minimize */}
            <Show when={mode() === 'floating'}>
              <button class="ai-panel-btn-icon" title={minimized() ? 'Expand' : 'Minimize'}
                onClick={() => setMinimized(!minimized())}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </Show>
            {/* Close */}
            <button class="ai-panel-btn-icon ai-panel-close-btn" title="Close"
              onClick={() => setAiPanelVisible(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <Show when={!minimized()}>
          {/* ── Quick Actions Toolbar ── */}
          <div class="ai-toolbar">
            <button class="ai-toolbar-btn" onClick={() => quickAction('summarize')} disabled={isLoading() || !online()} title="Summarize">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M4 6h16M4 10h16M4 14h10M4 18h7"/></svg>
            </button>
            <button class="ai-toolbar-btn" onClick={() => quickAction('explain')} disabled={isLoading() || !online()} title="Explain">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            </button>
            <button class="ai-toolbar-btn" onClick={() => quickAction('extract')} disabled={isLoading() || !online()} title="Extract data">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
            </button>
            <button class="ai-toolbar-btn" onClick={() => quickAction('translate')} disabled={isLoading() || !online()} title="Translate">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M5 8l6 10M11 8L5 18M2 12h14"/></svg>
            </button>
            <button class="ai-toolbar-btn" onClick={() => quickAction('rewrite')} disabled={isLoading() || !online()} title="Rewrite">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>

            <span class="ai-toolbar-sep" />

            <button class="ai-toolbar-btn" onClick={clearChat} disabled={isLoading() || !online()} title="Clear chat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>

            <span class="ai-toolbar-sep" />

            {/* Context selector */}
            <select class="ai-context-select" value={context()}
              onChange={(e) => { setContext(e.target.value); persist(); }}>
              <option value="page">{t('ai.thisPage') || 'This page'}</option>
              <option value="all">{t('ai.allPages') || 'All pages'}</option>
              <option value="selection">{t('ai.selection') || 'Selection'}</option>
            </select>
          </div>

          {/* ── Offline banner ── */}
          <Show when={!online()}>
            <div class="ai-offline-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
              </svg>
              Offline — AI features unavailable
            </div>
          </Show>

          {/* ── Messages ── */}
          <div class="ai-messages">
            <Show when={messages().length === 0 && !streamingContent() && !isLoading()}>
              <div class="ai-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
                  <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/>
                  <circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M9 17h6"/>
                </svg>
                <div>Ask a question or use the toolbar above</div>
              </div>
            </Show>

            <For each={messages()}>
              {(msg) => (
                <div class={`ai-message ai-message-${msg.role}`}>
                  <Show when={msg.role === 'assistant'}>
                    <div class="ai-message-actions">
                      <button class="ai-msg-copy-btn" title="Copy" onClick={() => copyMessage(msg.content)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      </button>
                    </div>
                  </Show>
                  <Show when={msg.role === 'user'}>
                    <div class="ai-message-content">{msg.content}</div>
                  </Show>
                  <Show when={msg.role === 'assistant'}>
                    <div class="ai-message-content ai-markdown" innerHTML={renderMarkdown(msg.content)} />
                  </Show>
                </div>
              )}
            </For>

            <Show when={streamingContent()}>
              <div class="ai-message ai-message-assistant">
                <div class="ai-message-content ai-markdown" innerHTML={renderMarkdown(streamingContent())} />
              </div>
            </Show>

            <Show when={isLoading() && !streamingContent()}>
              <div class="ai-message ai-message-assistant">
                <div class="ai-loading-dots"><span/><span/><span/></div>
              </div>
            </Show>

            <div ref={messagesEnd} />
          </div>

          {/* ── Input ── */}
          <div class="ai-input-area">
            <textarea
              ref={textareaRef}
              class="ai-input"
              placeholder={t('ai.askPlaceholder') || 'Ask about this document...'}
              value={input()}
              onInput={(e) => { setInput(e.target.value); autoGrow(e); }}
              onKeyDown={handleKeyDown}
              disabled={isLoading()}
              rows="1"
            />
            <button class="ai-send-btn" onClick={handleSend} disabled={isLoading() || !input().trim() || !online()}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </div>

          {/* ── Usage + Account ── */}
          <div class="ai-footer">
            <Show when={usage()}>
              <div class="ai-usage-bar">
                <div class="ai-usage-text">
                  {usage().credits_remaining} of {usage().credits_limit} credits remaining
                  <Show when={subscription()}>
                    <span class="ai-plan-badge">{subscription().plan_name}</span>
                  </Show>
                </div>
                <div class="ai-usage-track">
                  <div class="ai-usage-fill"
                    style={{ width: `${Math.min(100, (usage().credits_used / usage().credits_limit) * 100)}%` }} />
                </div>
              </div>
            </Show>
          </div>
        </Show>

        {/* ── Resize handles (floating only) ── */}
        <Show when={mode() === 'floating' && !minimized()}>
          <div class="ai-resize ai-resize-e" onMouseDown={(e) => startResize(e, 1, 0)} />
          <div class="ai-resize ai-resize-s" onMouseDown={(e) => startResize(e, 0, 1)} />
          <div class="ai-resize ai-resize-w" onMouseDown={(e) => startResize(e, -1, 0)} />
          <div class="ai-resize ai-resize-se" onMouseDown={(e) => startResize(e, 1, 1)} />
          <div class="ai-resize ai-resize-sw" onMouseDown={(e) => startResize(e, -1, 1)} />
        </Show>
      </div>
    </Show>
  );
}
