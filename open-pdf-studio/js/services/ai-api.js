import { isTauri } from '../core/platform.js';
import { requireOnline, withRetry } from './connectivity.js';

const API_BASE = 'https://ai.impertio.app';

let _accessToken = null;
let _refreshToken = null;

// ── Token storage (Tauri FS for desktop, localStorage fallback) ──

async function getTokenPath() {
  if (!isTauri() || !window.__TAURI__?.path) return null;
  const appDataDir = await window.__TAURI__.path.appDataDir();
  return appDataDir + 'ai-tokens.json';
}

export async function setTokens(access, refresh) {
  _accessToken = access;
  _refreshToken = refresh;

  const path = await getTokenPath();
  if (path && window.__TAURI__?.fs) {
    try {
      const data = JSON.stringify({ a: access, r: refresh });
      await window.__TAURI__.fs.writeTextFile(path, data);
    } catch { /* fallback to localStorage */ }
  }
  // Fallback
  if (access) localStorage.setItem('ai_access_token', access);
  if (refresh) localStorage.setItem('ai_refresh_token', refresh);
}

export async function loadTokens() {
  const path = await getTokenPath();
  if (path && window.__TAURI__?.fs) {
    try {
      const data = await window.__TAURI__.fs.readTextFile(path);
      const parsed = JSON.parse(data);
      _accessToken = parsed.a || null;
      _refreshToken = parsed.r || null;
      return { accessToken: _accessToken, refreshToken: _refreshToken };
    } catch { /* fallback */ }
  }
  // Fallback to localStorage
  _accessToken = localStorage.getItem('ai_access_token');
  _refreshToken = localStorage.getItem('ai_refresh_token');
  return { accessToken: _accessToken, refreshToken: _refreshToken };
}

export async function clearTokens() {
  _accessToken = null;
  _refreshToken = null;
  localStorage.removeItem('ai_access_token');
  localStorage.removeItem('ai_refresh_token');

  const path = await getTokenPath();
  if (path && window.__TAURI__?.fs) {
    try { await window.__TAURI__.fs.remove(path); } catch { /* ok */ }
  }
}

export function isLoggedIn() {
  return !!_accessToken;
}

// ── HTTP helpers ──

async function authFetch(path, options = {}) {
  requireOnline();
  if (!_accessToken) throw new Error('Not authenticated');

  const headers = { 'Content-Type': 'application/json', ...options.headers };
  headers['Authorization'] = 'Bearer ' + _accessToken;

  let res = await fetch(API_BASE + path, { ...options, headers });

  if (res.status === 401 && _refreshToken) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      headers['Authorization'] = 'Bearer ' + _accessToken;
      res = await fetch(API_BASE + path, { ...options, headers });
    }
  }

  return res;
}

async function refreshTokens() {
  try {
    const res = await fetch(API_BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: _refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    await setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// ── Auth API ──

export async function register(email, password, fullName) {
  requireOnline('Cannot create account while offline.');
  const res = await fetch(API_BASE + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, full_name: fullName || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Registration failed');
  }
  const data = await res.json();
  await setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function login(email, password) {
  requireOnline('Cannot sign in while offline.');
  const res = await fetch(API_BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Login failed');
  }
  const data = await res.json();
  await setTokens(data.access_token, data.refresh_token);
  return data;
}

// ── Data API ──

export async function getMe() {
  const res = await authFetch('/auth/me');
  if (!res.ok) return null;
  return res.json();
}

export async function getUsage() {
  const res = await authFetch('/usage');
  if (!res.ok) return null;
  return res.json();
}

export async function getPlans() {
  const res = await fetch(API_BASE + '/billing/plans');
  if (!res.ok) return [];
  return res.json();
}

export async function getSubscription() {
  const res = await authFetch('/billing/subscription');
  if (!res.ok) return null;
  return res.json();
}

export async function createCheckout(plan) {
  const res = await authFetch('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Checkout failed');
  }
  return res.json();
}

// ── Chat API ──

export async function chatSync(action, text, options = {}) {
  const res = await authFetch('/v1/chat', {
    method: 'POST',
    body: JSON.stringify({ action, text, stream: false, ...options }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'AI request failed');
  }
  return res.json();
}

export async function* chatStream(action, text, options = {}) {
  const res = await authFetch('/v1/chat', {
    method: 'POST',
    body: JSON.stringify({ action, text, stream: true, ...options }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'AI request failed');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // Incomplete JSON chunk — wait for next line
      }
    }
  }
}
