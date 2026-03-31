import { Show, createSignal, onCleanup } from 'solid-js';
import {
  isAuthenticated, user, usage, subscription,
  logout, refreshUserData, setAiPanelVisible
} from '../stores/aiStore.js';
import { openDialog } from '../stores/dialogStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';

function formatTokens(n) {
  if (!n && n !== 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

function getInitials(u) {
  if (!u) return '?';
  if (u.full_name) {
    return u.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  return u.email[0].toUpperCase();
}

export default function AccountDropdown() {
  const { t } = useTranslation('ribbon');
  const [open, setOpen] = createSignal(false);
  let dropdownRef;

  function handleClickOutside(e) {
    if (dropdownRef && !dropdownRef.contains(e.target)) {
      setOpen(false);
    }
  }

  function toggle(e) {
    e.stopPropagation();
    if (!isAuthenticated()) {
      openDialog('ai-login');
      return;
    }
    setOpen(!open());
    if (!open()) {
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

  function handleUpgrade() {
    setOpen(false);
    openDialog('ai-plan');
  }

  const creditsUsed = () => usage()?.credits_used || 0;
  const creditsLimit = () => usage()?.credits_limit || 0;
  const creditsRemaining = () => usage()?.credits_remaining || 0;
  const usagePercent = () => creditsLimit() > 0 ? Math.min(100, (creditsUsed() / creditsLimit()) * 100) : 0;

  return (
    <div class="account-dropdown-wrapper" ref={dropdownRef}>
      <button class="account-btn" title={isAuthenticated() ? (user()?.email || 'Account') : t('ai.signIn')}
        onClick={toggle}>
        <Show when={isAuthenticated()} fallback={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        }>
          <span class="account-avatar">{getInitials(user())}</span>
        </Show>
      </button>

      <Show when={open()}>
        <div class="account-dropdown">
          <div class="account-dropdown-header">
            <div class="account-avatar-large">{getInitials(user())}</div>
            <div class="account-info">
              <div class="account-email">{user()?.email}</div>
              <Show when={user()?.full_name}>
                <div class="account-name">{user()?.full_name}</div>
              </Show>
            </div>
          </div>

          <div class="account-dropdown-divider" />

          <div class="account-plan-section">
            <div class="account-plan-row">
              <span class="account-plan-label">Plan</span>
              <span class={`account-plan-badge account-plan-${subscription()?.plan_name || 'free'}`}>
                {(subscription()?.plan_name || 'free').charAt(0).toUpperCase() + (subscription()?.plan_name || 'free').slice(1)}
              </span>
            </div>
            <div class="account-usage-row">
              <span class="account-usage-label">
                {creditsRemaining()} of {creditsLimit()} credits
              </span>
            </div>
            <div class="account-usage-track">
              <div class="account-usage-fill" style={{ width: `${usagePercent()}%` }} />
            </div>
          </div>

          <div class="account-dropdown-divider" />

          <button class="account-dropdown-item" onClick={handleUpgrade}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M12 2l3 9h9l-7 5 3 9-8-6-8 6 3-9-7-5h9z"/>
            </svg>
            {t('ai.upgradePlan')}
          </button>

          <div class="account-dropdown-divider" />

          <button class="account-dropdown-item account-signout" onClick={handleSignOut}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            {t('ai.signOut')}
          </button>
        </div>
      </Show>
    </div>
  );
}
