// OpenAEC assistant — floating chat panel (bottom-right) + launcher button,
// mirroring the Open Calc Studio ChatPanel. Talks to the OpenAEC AI backend
// (POST /me/ai/complete) via the signed-in OpenAEC account; no extra backend.
import { createSignal, For, Show, createEffect } from 'solid-js';
import { openaecUser, openaecSignIn, openaecAiComplete } from '../stores/openaecStore.js';
import { getActiveDocument } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const GREETING =
  'Hallo! Ik ben de **OpenAEC-assistent**. Stel een vraag over het geopende PDF-document of vraag om hulp — bijvoorbeeld een samenvatting, uitleg of een vertaling.';

// Minimal markdown-lite rendering (bold, inline code, line breaks). The AI text
// is HTML-escaped first so it can never inject markup.
function renderContent(text) {
  const esc = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function describeAiError(err) {
  const raw = String(err?.message ?? err ?? '').trim();
  if (/\b401\b|niet ingelogd|invalid_grant|log opnieuw/i.test(raw)) {
    return '⚠️ Niet (meer) ingelogd bij OpenAEC. Log opnieuw in via de knop rechtsboven en probeer het opnieuw.';
  }
  if (/\b402\b|insufficient credits/i.test(raw)) {
    return '⚠️ Je OpenAEC AI-tegoed is op. Koop tokens bij in de OpenAEC-portal.';
  }
  if (/onbereikbaar|connection|econn|refused|failed to connect|timed out/i.test(raw)) {
    return '⚠️ Geen verbinding met de OpenAEC-dienst. Draait de accounts-server?';
  }
  return `⚠️ AI-aanroep mislukt.\n\n_Detail: ${raw || 'onbekende fout'}_`;
}

export default function AssistantPanel() {
  const { t } = useTranslation('common');
  const [open, setOpen] = createSignal(false);
  const [messages, setMessages] = createSignal([{ role: 'assistant', content: GREETING }]);
  const [input, setInput] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [credits, setCredits] = createSignal(null);
  let messagesEnd, inputEl;

  const activeDocName = () => getActiveDocument()?.fileName || null;

  // Auto-scroll to the newest message whenever the list changes.
  createEffect(() => {
    messages();
    queueMicrotask(() => messagesEnd?.scrollIntoView({ behavior: 'smooth' }));
  });

  function systemPrompt() {
    return 'Je bent de OpenAEC-assistent in Open PDF Studio (een PDF-annotatie-editor). Help de gebruiker met vragen over het geopende PDF-document en algemene taken. Antwoord in het Nederlands, bondig en praktisch.';
  }

  async function send() {
    const text = input().trim();
    if (!text || loading()) return;
    if (!openaecUser()) {
      await openaecSignIn();
      if (!openaecUser()) return; // cancelled / failed
    }

    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    try {
      const history = messages()
        .slice(1)
        .map((m) => `${m.role === 'user' ? 'Gebruiker' : 'Assistent'}: ${m.content}`)
        .join('\n\n');
      const docName = activeDocName();
      const prompt = `${docName ? `Geopend document: ${docName}\n\n` : ''}${history}\n\nAssistent:`;
      const res = await openaecAiComplete(prompt, systemPrompt());
      const answer = (res && (res.text ?? res.answer)) || 'Geen antwoord ontvangen.';
      if (res?.credits?.total != null) setCredits(res.credits.total);
      setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: describeAiError(e) }]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const chips = ['Vat dit document samen', 'Waar gaat deze PDF over?', 'Vertaal de geselecteerde tekst'];

  return (
    <Show
      when={open()}
      fallback={
        <button class="chat-fab" title={t('assistantTitle') || 'OpenAEC-assistent'} onClick={() => setOpen(true)}>💬</button>
      }
    >
      <div class="chat-floating">
        <div class="chat-panel">
          <div class="chat-header">
            <div class="chat-header-titles">
              <span class="chat-title">✨ OpenAEC-assistent</span>
              <span class="chat-subtitle" title={activeDocName() || ''}>
                {activeDocName() ? `werkt in: ${activeDocName()}` : 'geen document geopend'}
              </span>
            </div>
            <Show when={credits() != null}>
              <span class="chat-credits" title="Resterend AI-tegoed (tokens)">{credits()} tokens</span>
            </Show>
            <button class="chat-close" title={t('close') || 'Close'} onClick={() => setOpen(false)}>✕</button>
          </div>

          <div class="chat-messages">
            <For each={messages()}>
              {(msg) => (
                <div class={`chat-message chat-${msg.role}`}>
                  <div class="chat-bubble" innerHTML={renderContent(msg.content)} />
                </div>
              )}
            </For>
            <Show when={loading()}>
              <div class="chat-message chat-assistant"><div class="chat-bubble chat-typing">Denken…</div></div>
            </Show>
            <div ref={messagesEnd} />
          </div>

          <Show when={messages().length <= 1 && !loading()}>
            <div class="chat-chips">
              <For each={chips}>
                {(s) => <button class="chat-chip" onClick={() => { setInput(s); inputEl?.focus(); }}>{s}</button>}
              </For>
            </div>
          </Show>

          <div class="chat-input-area">
            <textarea
              ref={inputEl}
              class="chat-input"
              value={input()}
              onInput={(e) => setInput(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              placeholder="Vraag iets over deze PDF…"
              rows={2}
            />
            <button class="chat-send" onClick={send} disabled={loading() || !input().trim()}>➤</button>
          </div>
        </div>
      </div>
    </Show>
  );
}
