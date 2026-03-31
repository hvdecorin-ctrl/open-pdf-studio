import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { login, register, setAiPanelVisible, online } from '../../stores/aiStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function AILoginDialog(props) {
  const { t } = useTranslation('ribbon');
  const [mode, setMode] = createSignal('login');
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [fullName, setFullName] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode() === 'login') {
        await login(email(), password());
      } else {
        await register(email(), password(), fullName());
      }
      closeDialog('ai-login');
      setAiPanelVisible(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      title={mode() === 'login' ? t('ai.signInTitle') : t('ai.createAccountTitle')}
      dialogClass="ai-login-dialog"
      onClose={() => closeDialog('ai-login')}
      footer={null}
    >
      <form class="ai-login-form" onSubmit={handleSubmit}>
        <Show when={!online()}>
          <div class="ai-offline-banner" style="margin-bottom: 8px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><line x1="12" y1="20" x2="12.01" y2="20"/>
            </svg>
            No internet connection
          </div>
        </Show>
        {error() && <div class="ai-login-error">{error()}</div>}

        {mode() === 'register' && (
          <div class="ai-login-field">
            <label>{t('ai.fullName')}</label>
            <input type="text" value={fullName()} onInput={e => setFullName(e.target.value)} />
          </div>
        )}

        <div class="ai-login-field">
          <label>{t('ai.email')}</label>
          <input type="email" value={email()} onInput={e => setEmail(e.target.value)} placeholder="email@example.com" required />
        </div>

        <div class="ai-login-field">
          <label>{t('ai.password')}</label>
          <input type="password" value={password()} onInput={e => setPassword(e.target.value)} required minLength="6" />
        </div>

        <button class="ai-login-submit" type="submit" disabled={loading() || !online()}>
          {loading() ? '...' : (mode() === 'login' ? t('ai.signIn') : t('ai.createAccount'))}
        </button>

        <div class="ai-login-switch">
          {mode() === 'login' ? (
            <span>{t('ai.noAccount')} <a href="#" onClick={(e) => { e.preventDefault(); setMode('register'); setError(''); }}>{t('ai.createOne')}</a></span>
          ) : (
            <span>{t('ai.haveAccount')} <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setError(''); }}>{t('ai.signInLink')}</a></span>
          )}
        </div>
      </form>
    </Dialog>
  );
}
