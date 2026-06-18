// OpenAEC Accounts — platform-login ("Sign in with OpenAEC").
//
// Thin Solid store around the Rust commands in src-tauri/src/accounts.rs:
// the OIDC/PKCE flow, token storage (OS keyring) and the authenticated
// Accounts API all live at the Rust side; the webview only ever sees the
// user profile (sub/name/email). Mirrors the Open Calc Studio integration —
// same contract: openaec-accounts/docs/integrations/open-pdf-studio.md.

import { createSignal } from 'solid-js';
import { isTauri } from '../../core/platform.js';

const [user, setUser] = createSignal(null);   // { sub, name, email } | null
const [busy, setBusy] = createSignal(false);
const [error, setError] = createSignal(null); // transient, auto-clears

export { user as openaecUser, busy as openaecBusy, error as openaecError };

function _invoke(cmd, args) {
  const inv = window.__TAURI__?.core?.invoke;
  if (!inv) return Promise.reject(new Error('alleen beschikbaar in de desktop-app'));
  return inv(cmd, args);
}

function _flashError(e) {
  setError(String(e?.message ?? e));
  setTimeout(() => setError(null), 6000);
}

/** Restore the signed-in user from the keyring (app start). */
export async function openaecLoadUser() {
  if (!isTauri()) return;
  try {
    const u = await _invoke('accounts_get_user');
    setUser(u || null);
  } catch (_) { /* keyring unavailable — stay signed out */ }
}

/** Launch the system-browser OIDC login; resolves with the user profile. */
export async function openaecSignIn() {
  if (busy()) return;
  setBusy(true);
  setError(null);
  try {
    const u = await _invoke('accounts_sign_in');
    setUser(u || null);
  } catch (e) {
    _flashError(e);
  } finally {
    setBusy(false);
  }
}

/** Wipe tokens (local sign-out). */
export async function openaecSignOut() {
  try { await _invoke('accounts_sign_out'); } catch (_) {}
  setUser(null);
}

/** Authenticated Accounts API call, e.g. openaecFetch('/me/apps'). */
export function openaecFetch(path, method, body) {
  return _invoke('accounts_fetch', { path, method, body });
}

/** Upload a file (e.g. the current PDF) to OpenAEC cloud storage (/me/files). */
export function openaecUploadFile(fileName, bytes) {
  return _invoke('accounts_upload_file', { fileName, content: Array.from(bytes) });
}

/** List the user's cloud files (/me/files). */
export function openaecListFiles() {
  return _invoke('accounts_fetch', { path: '/me/files', method: 'GET' });
}

/** Download a cloud file by id; resolves with base64-encoded bytes. */
export function openaecDownloadFile(id) {
  return _invoke('accounts_download_file', { id });
}

/** OpenAEC AI completion (POST /me/ai/complete) → { text, credits }. */
export function openaecAiComplete(prompt, system) {
  return openaecFetch('/me/ai/complete', 'POST', { prompt, system, app: 'open-pdf-studio' });
}

// Restore session once at module load (fire-and-forget).
openaecLoadUser();
