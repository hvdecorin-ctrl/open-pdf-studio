/**
 * Connectivity monitor — tracks online/offline state and notifies listeners.
 * Uses navigator.onLine + real ping to the API for accurate detection.
 */

const API_BASE = 'https://ai.impertio.app';
const PING_TIMEOUT = 5000;

let _online = navigator.onLine;
let _listeners = [];

/** Whether the app is currently online. */
export function isOnline() {
  return _online;
}

/** Register a callback for connectivity changes. Returns unsubscribe function. */
export function onConnectivityChange(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(f => f !== fn); };
}

function _notify(online) {
  if (_online === online) return;
  _online = online;
  for (const fn of _listeners) {
    try { fn(online); } catch { /* listener error */ }
  }
}

/** Verify connectivity with a real server ping (navigator.onLine can lie). */
async function _verifyOnline() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const res = await fetch(API_BASE + '/health', {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Browser events ──
window.addEventListener('online', async () => {
  const real = await _verifyOnline();
  _notify(real);
});

window.addEventListener('offline', () => {
  _notify(false);
});

/** Check connectivity now (async). Updates internal state and notifies. */
export async function checkConnectivity() {
  if (!navigator.onLine) {
    _notify(false);
    return false;
  }
  const real = await _verifyOnline();
  _notify(real);
  return real;
}

/**
 * Guard: throws if offline. Use before API calls.
 * @param {string} message - Custom offline message
 */
export function requireOnline(message) {
  if (!_online) {
    throw new OfflineError(message || 'You are offline. AI features require an internet connection.');
  }
}

/** Custom error class for offline state. */
export class OfflineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OfflineError';
  }
}

/**
 * Retry wrapper — retries once on network failure.
 * @param {Function} fn - async function to execute
 * @returns {Promise} result of fn
 */
export async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OfflineError) throw err;
    if (err.name === 'TypeError' || err.message?.includes('fetch')) {
      // Network error — retry once after a short delay
      await new Promise(r => setTimeout(r, 1000));
      const online = await checkConnectivity();
      if (!online) throw new OfflineError('Connection lost. Please check your internet connection.');
      return await fn();
    }
    throw err;
  }
}
