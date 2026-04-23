import { Show, createSignal, onCleanup } from 'solid-js';
import {
  isAuthenticated, user, info, usage, subscription,
  logout, login, refreshUserData, setAiPanelVisible,
} from '../stores/aiStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const BILLING_URL = 'https://account.impertio.app/billing';
const PRICING_URL = 'https://account.impertio.app/pricing';

function openExternal(url) {
  if (window.__TAURI__?.core?.invoke) {
    // Use the already-registered `open_url` Tauri command so the link
    // opens in the user's default browser, not the in-app webview.
    window.__TAURI__.core.invoke('open_url', { url }).catch(err => {
      console.warn('[account] open_url failed:', err);
      window.open(url, '_blank', 'noopener');
    });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

function getInitial(u) {
  if (!u) return '?';
  const source = u.name || u.email || u.sub || '';
  const ch = source.trim().charAt(0);
  return (ch || '?').toUpperCase();
}

function displayName(u) {
  if (!u) return '';
  return u.name || u.email || (u.sub ? u.sub.slice(0, 8) : '');
}

function formatResets(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
}

export default function AccountDropdown() {
  const { t } = useTranslation('ribbon');
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let dropdownRef;

  function handleClickOutside(e) {
    if (dropdownRef && !dropdownRef.contains(e.target)) setOpen(false);
  }

  async function toggle(e) {
    e.stopPropagation();
    if (!isAuthenticated()) {
      if (busy()) return;
      setBusy(true);
      try { await login(); } catch (err) { console.warn('[account] sign-in cancelled:', err); }
      setBusy(false);
      return;
    }
    const next = !open();
    setOpen(next);
    if (!next) {
      document.removeEventListener('mousedown', handleClickOutside);
    } else {
      refreshUserData();
      setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
    }
  }

  onCleanup(() => document.removeEventListener('mousedown', handleClickOutside));

  function handleSignOut() {
    setOpen(false);
    setAiPanelVisible(false);
    logout();
  }

  const planTier = () => info()?.subscription?.tier || 'free';
  const planLabel = () => {
    const tier = planTier();
    switch (tier) {
      case 'pro': return t('ai.planPro') || 'Pro';
      case 'studio': return t('ai.planStudio') || 'Studio';
      default: return t('ai.planFree') || 'Free';
    }
  };
  const creditsTotal = () => info()?.credits?.total;
  const resetsLabel = () => {
    const d = formatResets(info()?.credits?.resets_at);
    return d ? (t('ai.creditsResetsAt', { date: d }) || `Resets ${d}`) : null;
  };

  return (
    <div class="account-dropdown-wrapper" ref={dropdownRef}>
      <button
        class="account-btn"
        title={isAuthenticated() ? displayName(user()) : (t('ai.signIn') || 'Sign in')}
        onClick={toggle}
        disabled={busy()}
      >
        <Show when={isAuthenticated()} fallback={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        }>
          <Show when={user()?.picture} fallback={<span class="account-avatar">{getInitial(user())}</span>}>
            <img class="account-avatar-img" src={user().picture} alt="" referrerPolicy="no-referrer" />
          </Show>
        </Show>
      </button>

      <Show when={open() && isAuthenticated()}>
        <div class="account-dropdown">
          <div class="account-dropdown-header">
            <Show when={user()?.picture} fallback={<div class="account-avatar-large">{getInitial(user())}</div>}>
              <img class="account-avatar-large-img" src={user().picture} alt="" referrerPolicy="no-referrer" />
            </Show>
            <div class="account-info">
              <div class="account-name">{displayName(user())}</div>
              <Show when={user()?.email && user()?.email !== displayName(user())}>
                <div class="account-email">{user().email}</div>
              </Show>
            </div>
          </div>

          <Show when={info()?.credits || info()?.subscription}>
            <div class="account-dropdown-divider" />

            <div class="account-plan-section">
              <Show when={info()?.credits}>
                <div class="account-credits-row">
                  <span class="account-credits-n">{creditsTotal()}</span>
                  <span class="account-credits-label">{t('ai.credits') || 'credits'}</span>
                </div>
                <Show when={resetsLabel()}>
                  <div class="account-credits-resets">{resetsLabel()}</div>
                </Show>
              </Show>
              <Show when={info()?.subscription}>
                <div class="account-plan-row">
                  <span class={`account-plan-badge account-plan-${planTier()}`}>{planLabel()}</span>
                  <Show when={planTier() === 'free'}>
                    <button
                      class="account-upgrade-link"
                      onClick={() => { setOpen(false); openExternal(PRICING_URL); }}
                    >
                      {t('ai.upgrade') || 'Upgrade'}
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>

          <div class="account-dropdown-divider" />

          <button class="account-dropdown-item" onClick={() => { setOpen(false); openExternal(BILLING_URL); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <rect x="3" y="6" width="18" height="13" rx="2"/>
              <path d="M3 10h18"/>
            </svg>
            {t('ai.manageAccount') || 'Manage account'}
          </button>

          <button class="account-dropdown-item account-signout" onClick={handleSignOut}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            {t('ai.signOut') || 'Sign out'}
          </button>
        </div>
      </Show>
    </div>
  );
}
