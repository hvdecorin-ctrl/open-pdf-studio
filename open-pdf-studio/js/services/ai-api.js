// AI API client.
//
// Auth is OIDC — the user signs in via the Rust backend (Authorization
// Code + PKCE against account.impertio.app) and tokens live in the
// tauri-plugin-store on the Rust side. This module asks for the access
// token at call time via `invoke('auth_get_access_token')`, which
// transparently refreshes the token if it's close to expiry.
//
// The AI server URL is discovered from /v1/app-config; for simplicity
// and to match where the backend actually runs today we just point at
// the known hostname and fall back gracefully on other errors.

import { isTauri } from '../core/platform.js';
import { requireOnline } from './connectivity.js';

const API_BASE = 'https://open-pdf-studio-ai.impertio.app';

function tauri() {
  return isTauri() && window.__TAURI__?.core?.invoke ? window.__TAURI__.core.invoke : null;
}

// ── Token (sourced from Rust each call) ──

async function getAccessToken() {
  const invoke = tauri();
  if (!invoke) return null;
  try {
    return await invoke('auth_get_access_token');
  } catch (e) {
    console.warn('[ai-api] auth_get_access_token failed:', e);
    return null;
  }
}

export async function isLoggedIn() {
  const t = await getAccessToken();
  return !!t;
}

// Back-compat exports; callers may have held onto these names. They now
// just proxy to the Rust-side commands.
export async function loadTokens() {
  // no-op: tokens live in the tauri-plugin-store.
  return {};
}

export async function clearTokens() {
  const invoke = tauri();
  if (!invoke) return;
  try {
    await invoke('auth_logout');
  } catch (e) {
    console.warn('[ai-api] auth_logout failed:', e);
  }
}

// ── OIDC sign-in / current user ──

export async function login() {
  const invoke = tauri();
  if (!invoke) throw new Error('Sign-in is only available in the desktop app.');
  requireOnline('Cannot sign in while offline.');
  return invoke('auth_login'); // returns UserProfile { sub, email, name, picture }
}

export async function currentUser() {
  const invoke = tauri();
  if (!invoke) return null;
  try {
    return await invoke('auth_current_user');
  } catch {
    return null;
  }
}

// /oauth/userinfo via Rust — returns { sub, email, name, picture, subscription:{tier,status}, credits:{total,monthly,topup,resets_at} }
export async function getUserInfo() {
  const invoke = tauri();
  if (!invoke) return null;
  try {
    return await invoke('auth_userinfo');
  } catch (e) {
    console.warn('[ai-api] auth_userinfo failed:', e);
    return null;
  }
}

// ── Chat API ──

async function authHeaders() {
  const token = await getAccessToken();
  if (!token) throw new Error('Not signed in');
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
}

export async function chatSync(action, text, options = {}) {
  requireOnline();
  const res = await fetch(API_BASE + '/v1/chat', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action, text, stream: false, ...options }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail?.message || err.detail || err.message || 'AI request failed');
  }
  return res.json();
}

export async function* chatStream(action, text, options = {}) {
  requireOnline();
  const res = await fetch(API_BASE + '/v1/chat', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action, text, stream: true, ...options }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail?.message || err.detail || err.message || 'AI request failed');
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
        // Incomplete chunk — wait for next line.
      }
    }
  }
}

// ── Deprecated exports kept as no-ops so older imports don't throw ──
// The local user/billing system is gone; these used to return local DB
// rows and are now replaced by getUserInfo() (plan + credits in one call).

export async function register() {
  throw new Error('Registration happens at account.impertio.app. Click Sign in to open it.');
}

export async function getMe() {
  return currentUser();
}

export async function getUsage() {
  const info = await getUserInfo();
  return info?.credits || null;
}

export async function getSubscription() {
  const info = await getUserInfo();
  return info?.subscription || null;
}

export async function getPlans() {
  return [];
}

export async function createCheckout() {
  throw new Error('Manage your plan at account.impertio.app/billing');
}
