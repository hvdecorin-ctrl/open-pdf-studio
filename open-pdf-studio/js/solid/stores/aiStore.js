import { createSignal } from 'solid-js';
import {
  loadTokens, clearTokens, isLoggedIn, getMe, getUsage, getSubscription,
  chatStream, login as apiLogin, register as apiRegister
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

// ── Auth ──
const [user, setUser] = createSignal(null);
const [isAuthenticated, setIsAuthenticated] = createSignal(false);

// ── Usage ──
const [usage, setUsage] = createSignal(null);
const [subscription, setSubscription] = createSignal(null);

// ── Chat ──
const [messages, setMessages] = createSignal([]);
const [isLoading, setIsLoading] = createSignal(false);
const [streamingContent, setStreamingContent] = createSignal('');

// ── Initialization (async — runs after module loads) ──
let _initialized = false;

async function initAI() {
  if (_initialized) return;
  _initialized = true;
  try {
    await loadTokens();
    if (isLoggedIn()) {
      setIsAuthenticated(true);
      refreshUserData();
    }
  } catch (e) {
    console.warn('[AI] Init error:', e);
  }
}

// Trigger init immediately (non-blocking)
initAI();

async function refreshUserData() {
  try {
    const [me, sub, usg] = await Promise.all([
      getMe(), getSubscription(), getUsage()
    ]);
    if (me) setUser(me);
    if (sub) setSubscription(sub);
    if (usg) setUsage(usg);
  } catch (e) {
    console.warn('[AI] refreshUserData error:', e);
  }
}

async function login(email, password) {
  await initAI();
  await apiLogin(email, password);
  setIsAuthenticated(true);
  await refreshUserData();
}

async function register(email, password, fullName) {
  await initAI();
  await apiRegister(email, password, fullName);
  setIsAuthenticated(true);
  await refreshUserData();
}

async function logout() {
  await clearTokens();
  setIsAuthenticated(false);
  setUser(null);
  setUsage(null);
  setSubscription(null);
  setMessages([]);
  setAiPanelVisible(false);
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
    getUsage().then(u => { if (u) setUsage(u); });
    return full;
  } catch (err) {
    console.error('[AI] sendAction error:', err);
    // Keep partial response if stream was interrupted
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
    getUsage().then(u => { if (u) setUsage(u); });
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
  user, isAuthenticated, usage, subscription,
  messages, isLoading, streamingContent,
  login, register, logout, refreshUserData,
  sendAction, sendChat, clearChat, addMessage,
};
