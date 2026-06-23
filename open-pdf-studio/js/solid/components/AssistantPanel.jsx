// OpenAEC assistant — floating chat panel (bottom-right) + launcher button,
// mirroring the Open Calc Studio ChatPanel. Two providers, same order as OCS:
//   1. OpenAEC account   -> POST /me/ai/complete (when signed in via OpenAEC)
//   2. Claude (Anthropic) -> direct API with a locally stored API key
import { createSignal, For, Show, createEffect } from 'solid-js';
import { openaecUser, openaecSignIn, openaecAiComplete } from '../stores/openaecStore.js';
import { getActiveDocument } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const GREETING =
  'Hallo! Ik ben de **OpenAEC-assistent**. Stel een vraag over het geopende PDF-document of vraag om hulp — bijvoorbeeld een samenvatting, uitleg of een vertaling.';
const ANTHROPIC_KEY_LS = 'opds-anthropic-key';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

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
  if (/Claude API 401|invalid x-api-key|authentication_error/i.test(raw)) {
    return '⚠️ Ongeldige Claude (Anthropic) API-sleutel. Controleer de sleutel via het 🔑-knopje rechtsboven in het paneel.';
  }
  if (/Claude API 4\d\d|Claude API 5\d\d/i.test(raw)) {
    return `⚠️ De Claude-API gaf een fout.\n\n_Detail: ${raw}_`;
  }
  if (/\b401\b|niet ingelogd|invalid_grant|log opnieuw/i.test(raw)) {
    return '⚠️ Niet (meer) ingelogd bij OpenAEC. Log opnieuw in via de knop rechtsboven en probeer het opnieuw.';
  }
  if (/\b402\b|insufficient credits/i.test(raw)) {
    return '⚠️ Je OpenAEC AI-tegoed is op. Koop tokens bij in de OpenAEC-portal.';
  }
  if (/onbereikbaar|connection|econn|refused|failed to connect|timed out|failed to fetch/i.test(raw)) {
    return '⚠️ Geen verbinding met de AI-dienst.';
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
  const readKey = () => { try { return localStorage.getItem(ANTHROPIC_KEY_LS) || ''; } catch (_) { return ''; } };
  const [apiKey, setApiKey] = createSignal(readKey());
  const [showKey, setShowKey] = createSignal(false);
  let messagesEnd, inputEl, keyEl;

  const activeDocName = () => getActiveDocument()?.fileName || null;

  createEffect(() => {
    messages();
    queueMicrotask(() => messagesEnd?.scrollIntoView({ behavior: 'smooth' }));
  });

  function systemPrompt() {
    return 'Je bent de OpenAEC-assistent in Open PDF Studio (een PDF-annotatie-editor). Help de gebruiker met vragen over het geopende PDF-document en algemene taken. Antwoord in het Nederlands, bondig en praktisch.';
  }

  function saveKey() {
    const v = (keyEl?.value || '').trim();
    try {
      if (v) localStorage.setItem(ANTHROPIC_KEY_LS, v);
      else localStorage.removeItem(ANTHROPIC_KEY_LS);
    } catch (_) { /* private mode — ignore */ }
    setApiKey(v);
    setShowKey(false);
  }

  async function send() {
    const text = input().trim();
    if (!text || loading()) return;
    const key = apiKey();

    // No provider available — guide the user to sign in or set a Claude key.
    if (!openaecUser() && !key) {
      setMessages((m) => [
        ...m,
        { role: 'user', content: text },
        { role: 'assistant', content: 'Log in met **OpenAEC** (knop rechtsboven), of stel een **Claude (Anthropic) API-sleutel** in via het 🔑-knopje hierboven, om de assistent te gebruiken.' },
      ]);
      setInput('');
      return;
    }

    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    try {
      if (openaecUser()) {
        // (1) OpenAEC platform AI — flatten the history into one prompt.
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
      } else {
        // (2) Claude (Anthropic) direct — like Open Calc Studio.
        const msgs = messages()
          .slice(1)
          .map((m) => ({ role: m.role, content: m.content }));
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: 1024,
            system: systemPrompt(),
            messages: msgs,
          }),
        });
        if (!res.ok) {
          const tx = await res.text().catch(() => '');
          throw new Error(`Claude API ${res.status}: ${tx.slice(0, 200)}`);
        }
        const data = await res.json();
        const answer = data?.content?.[0]?.text || 'Geen antwoord ontvangen.';
        setMessages((m) => [...m, { role: 'assistant', content: answer }]);
      }
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

  // Subtitle shows the active provider so the user knows where answers come from.
  const providerLabel = () => (openaecUser() ? 'via OpenAEC' : (apiKey() ? 'via Claude' : 'niet verbonden'));

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
                {activeDocName() ? `werkt in: ${activeDocName()} · ${providerLabel()}` : providerLabel()}
              </span>
            </div>
            <Show when={credits() != null}>
              <span class="chat-credits" title="Resterend AI-tegoed (tokens)">{credits()} tokens</span>
            </Show>
            <button class="chat-close" title="Claude (Anthropic) API-sleutel instellen" onClick={() => setShowKey(!showKey())}>🔑</button>
            <button class="chat-close" title={t('close') || 'Close'} onClick={() => setOpen(false)}>✕</button>
          </div>

          <Show when={showKey()}>
            <div class="chat-keyrow">
              <input
                ref={keyEl}
                type="password"
                class="chat-keyinput"
                placeholder="Claude (Anthropic) API-sleutel — sk-ant-…"
                value={apiKey()}
                onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }}
              />
              <button class="chat-keysave" onClick={saveKey}>Opslaan</button>
            </div>
          </Show>

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
