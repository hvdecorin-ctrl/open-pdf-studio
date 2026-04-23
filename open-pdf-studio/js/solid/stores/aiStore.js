import { createSignal } from 'solid-js';
import {
  clearTokens, currentUser, getUserInfo,
  chatStream, login as apiLogin,
} from '../../services/ai-api.js';
import { isOnline, onConnectivityChange, OfflineError } from '../../services/connectivity.js';

// ── Visibility ──
const [aiPanelVisible, setAiPanelVisible] = createSignal(false);

// ── Connectivity ──
const [online, setOnline] = createSignal(isOnline());
onConnectivityChange((status) => {
  setOnline(status);
  if (status && isAuthenticated()) refreshUserData();
});

// ── Auth + profile ──
// `user` is the minimal profile decoded from the stored JWT (sub/email/name/picture).
// `info` is the fresh /oauth/userinfo payload (same claims + subscription + credits).
// `subscription` and `usage` are thin aliases over info for back-compat with
// existing components that already read those signals.
const [user, setUser] = createSignal(null);
const [info, setInfo] = createSignal(null);
const [isAuthenticated, setIsAuthenticated] = createSignal(false);

const subscription = () => info()?.subscription || null;
const usage = () => info()?.credits || null;

// ── Chat ──
const [messages, setMessages] = createSignal([]);
const [isLoading, setIsLoading] = createSignal(false);
const [streamingContent, setStreamingContent] = createSignal('');

// ── Initialization ──
let _initialized = false;

async function initAI() {
  if (_initialized) return;
  _initialized = true;
  try {
    const u = await currentUser();
    if (u) {
      setUser(u);
      setIsAuthenticated(true);
      refreshUserData();
    }
  } catch (e) {
    console.warn('[AI] init error:', e);
  }
}

// Non-blocking hydrate on module load.
initAI();

// Debounced refresh — /userinfo is rate-limited to 120 req/min/IP by the
// accounts server, and we only need roughly-live data.
const USERINFO_DEBOUNCE_MS = 5000;
let _lastInfoFetch = 0;

async function refreshUserData() {
  if (!isAuthenticated()) return;
  const now = Date.now();
  if (now - _lastInfoFetch < USERINFO_DEBOUNCE_MS) return;
  _lastInfoFetch = now;
  try {
    const i = await getUserInfo();
    if (i) {
      setInfo(i);
      // /userinfo is the source of truth for name/picture between sessions;
      // patch the lightweight profile so avatar + display name stay fresh.
      const cur = user();
      if (cur) {
        setUser({ ...cur, name: i.name ?? cur.name, picture: i.picture ?? cur.picture, email: i.email ?? cur.email });
      }
    }
  } catch (e) {
    console.warn('[AI] refreshUserData error:', e);
  }
}

// Triggers the OIDC PKCE flow (Rust opens a browser + waits on a loopback).
async function login() {
  await initAI();
  const u = await apiLogin();
  setUser(u);
  setIsAuthenticated(true);
  _lastInfoFetch = 0;
  await refreshUserData();
}

async function logout() {
  await clearTokens();
  setIsAuthenticated(false);
  setUser(null);
  setInfo(null);
  setMessages([]);
  setAiPanelVisible(false);
}

// For gated actions (AI features): ensure the user is signed in, kicking
// off the OIDC flow if not. Returns true on success, false if the user
// dismissed the browser flow or it errored.
async function requireSignIn() {
  if (isAuthenticated()) return true;
  try {
    await login();
    return isAuthenticated();
  } catch (e) {
    console.warn('[AI] sign-in cancelled or failed:', e);
    return false;
  }
}

function addMessage(role, content, action) {
  setMessages(prev => [...prev, { role, content, action, timestamp: Date.now() }]);
}

function clearChat() {
  setMessages([]);
}

async function sendAction(action, text, options = {}) {
  await initAI();
  setIsLoading(true);
  setStreamingContent('');

  const displayText = options.question || (text.length > 100 ? text.slice(0, 100) + '...' : text);
  addMessage('user', displayText, action);

  try {
    let full = '';
    for await (const chunk of chatStream(action, text, options)) {
      full += chunk;
      setStreamingContent(full);
    }

    addMessage('assistant', full, action);
    setStreamingContent('');
    _lastInfoFetch = 0; // force fresh credits on next dropdown open
    refreshUserData();
    return full;
  } catch (err) {
    console.error('[AI] sendAction error:', err);
    const partial = streamingContent();
    if (partial) {
      addMessage('assistant', partial + '\n\n---\n*Connection lost. Response may be incomplete.*', action);
      setStreamingContent('');
    } else if (err instanceof OfflineError) {
      addMessage('assistant', err.message, 'error');
    } else {
      addMessage('assistant', 'Error: ' + err.message, 'error');
    }
  } finally {
    setIsLoading(false);
  }
}

async function sendChat(text) {
  await initAI();
  const history = messages()
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content }));

  setIsLoading(true);
  setStreamingContent('');
  addMessage('user', text, 'chat');

  try {
    let full = '';
    for await (const chunk of chatStream('chat', text, { history })) {
      full += chunk;
      setStreamingContent(full);
    }
    addMessage('assistant', full, 'chat');
    setStreamingContent('');
    _lastInfoFetch = 0;
    refreshUserData();
    return full;
  } catch (err) {
    console.error('[AI] sendChat error:', err);
    const partial = streamingContent();
    if (partial) {
      addMessage('assistant', partial + '\n\n---\n*Connection lost. Response may be incomplete.*', 'chat');
      setStreamingContent('');
    } else if (err instanceof OfflineError) {
      addMessage('assistant', err.message, 'error');
    } else {
      addMessage('assistant', 'Error: ' + err.message, 'error');
    }
  } finally {
    setIsLoading(false);
  }
}

export {
  online,
  aiPanelVisible, setAiPanelVisible,
  user, info, isAuthenticated, usage, subscription,
  messages, isLoading, streamingContent,
  login, logout, requireSignIn, refreshUserData,
  sendAction, sendChat, clearChat, addMessage,
};
