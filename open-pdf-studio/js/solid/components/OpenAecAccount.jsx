// "Sign in with OpenAEC" — platform-account in the title bar (mirrors the
// Open Calc Studio integration: sign-in button when signed out; avatar with
// initials + name and a dropdown when signed in).
import { Show, createSignal, onCleanup } from 'solid-js';
import {
  openaecUser, openaecBusy, openaecError,
  openaecSignIn, openaecSignOut,
} from '../stores/openaecStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';

// Up to two initials from the name (or email) — same rule as Open Calc Studio.
function initials(u) {
  const source = (u?.name || u?.email || '').trim();
  const out = source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return out || '?';
}

// OpenAEC portal (dev URL for now; configurable per environment, like OCS).
function openPortal() {
  const url = 'http://localhost:3000';
  try {
    if (window.__TAURI__?.shell?.open) { window.__TAURI__.shell.open(url); return; }
  } catch (_) { /* fall through to window.open */ }
  try { window.open(url, '_blank'); } catch (_) { /* ignore */ }
}

export default function OpenAecAccount() {
  const { t } = useTranslation('common');
  const [menuOpen, setMenuOpen] = createSignal(false);

  function closeMenu() { setMenuOpen(false); }

  function toggleMenu(e) {
    e.stopPropagation();
    const next = !menuOpen();
    setMenuOpen(next);
    // Match OCS: the account menu closes on the next window click.
    if (next) setTimeout(() => window.addEventListener('click', closeMenu, { once: true }), 0);
    else window.removeEventListener('click', closeMenu);
  }

  onCleanup(() => window.removeEventListener('click', closeMenu));

  async function handleSignIn() {
    try { await openaecSignIn(); } catch (_) { /* error surfaced via openaecError() */ }
  }

  return (
    <Show
      when={openaecUser()}
      fallback={
        <button
          class="openaec-signin-btn"
          onClick={handleSignIn}
          disabled={openaecBusy()}
          title={openaecError() || (t('openaecSignIn') || 'Sign in with OpenAEC')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13">
            <path d="M8 1.5 13.5 4.75v6.5L8 14.5 2.5 11.25v-6.5z" />
            <path d="M8 8v6.5M2.5 4.75 8 8l5.5-3.25" />
          </svg>
          {openaecBusy() ? (t('openaecSigningIn') || 'Signing in…') : (t('openaecSignIn') || 'Sign in with OpenAEC')}
        </button>
      }
    >
      <div class="openaec-account" onClick={(e) => e.stopPropagation()}>
        <button class="openaec-avatar-btn" onClick={toggleMenu} title={openaecUser().email || openaecUser().name}>
          <span class="openaec-avatar">{initials(openaecUser())}</span>
          <span class="openaec-account-name">{openaecUser().name || openaecUser().email}</span>
        </button>
        <Show when={menuOpen()}>
          <div class="openaec-account-menu">
            <div class="openaec-account-menu-header">
              <div class="openaec-account-menu-name">{openaecUser().name || openaecUser().email}</div>
              <Show when={openaecUser().email && openaecUser().email !== openaecUser().name}>
                <div class="openaec-account-menu-email">{openaecUser().email}</div>
              </Show>
            </div>
            <button class="openaec-account-menu-item" onClick={() => { setMenuOpen(false); openPortal(); }}>
              {t('openaecPortal') || 'Open Portal'}
            </button>
            <button class="openaec-account-menu-item" onClick={() => { setMenuOpen(false); import('../../pdf/cloud-save.js').then((m) => m.saveToOpenAecCloud()); }}>
              {t('openaecSaveToCloud') || 'Save to OpenAEC cloud'}
            </button>
            <button class="openaec-account-menu-item" onClick={() => { setMenuOpen(false); openaecSignOut(); }}>
              {t('openaecSignOut') || 'Sign out'}
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
