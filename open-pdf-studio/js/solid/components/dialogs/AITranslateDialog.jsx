import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { translatePage, translateDocument, undoTranslations } from '../../../services/ai-translate.js';
import { isAuthenticated } from '../../stores/aiStore.js';
import { openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const LANGUAGES = [
  'Arabic', 'Bengali', 'Bulgarian', 'Catalan', 'Chinese', 'Croatian', 'Czech',
  'Danish', 'Dutch', 'English', 'Finnish', 'French', 'German', 'Greek',
  'Hebrew', 'Hindi', 'Hungarian', 'Indonesian', 'Italian', 'Japanese', 'Korean',
  'Malay', 'Norwegian', 'Persian', 'Polish', 'Portuguese', 'Romanian', 'Russian',
  'Serbian', 'Slovak', 'Spanish', 'Swahili', 'Swedish', 'Tamil', 'Thai',
  'Turkish', 'Ukrainian', 'Urdu', 'Vietnamese',
];

export default function AITranslateDialog(props) {
  const { t } = useTranslation('ribbon');
  const data = props.data || {};
  const [language, setLanguage] = createSignal('English');
  const [scope, setScope] = createSignal(data.scope || 'page');
  const [translating, setTranslating] = createSignal(false);
  const [progress, setProgress] = createSignal('');
  const [result, setResult] = createSignal('');
  const [error, setError] = createSignal('');

  async function handleTranslate() {
    if (!isAuthenticated()) {
      closeDialog('ai-translate');
      openDialog('ai-login');
      return;
    }

    const doc = getActiveDocument();
    if (!doc || !doc.pdfDoc) {
      setError('No document open');
      return;
    }

    setTranslating(true);
    setError('');
    setResult('');

    try {
      let count;
      if (scope() === 'page') {
        count = await translatePage(doc.currentPage, language(), (curr, total) => {
          setProgress(`Translating block ${curr} of ${total}...`);
        });
        setResult(`Translated ${count} text blocks on page ${doc.currentPage}.`);
      } else {
        count = await translateDocument(language(), (page, totalPages, curr, total) => {
          setProgress(`Page ${page}/${totalPages} — block ${curr}/${total}...`);
        });
        setResult(`Translated ${count} text blocks across ${doc.pdfDoc.numPages} pages.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setTranslating(false);
      setProgress('');
    }
  }

  function handleUndo() {
    const doc = getActiveDocument();
    if (!doc) return;
    if (scope() === 'page') {
      undoTranslations(doc.currentPage);
      setResult('Translations removed from current page.');
    } else {
      undoTranslations(0);
      setResult('All translations removed.');
    }
  }

  return (
    <Dialog
      title={t('ai.translateDocument') || 'Translate Document'}
      dialogClass="ai-translate-dialog"
      onClose={() => closeDialog('ai-translate')}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
            onClick={handleUndo} disabled={translating()}>
            Undo Translations
          </button>
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px"
            onClick={handleTranslate} disabled={translating()}>
            {translating() ? 'Translating...' : 'Translate'}
          </button>
        </div>
      }
    >
      <div style="min-width:320px">
        <div class="ai-login-field">
          <label>Target Language</label>
          <PrefSelect
            value={language}
            setValue={setLanguage}
            options={LANGUAGES.map(lang => ({ value: lang, label: lang }))}
            style={{ width: '100%' }}
          />
        </div>

        <div class="ai-login-field">
          <label>Scope</label>
          <div style="display:flex;gap:12px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:default">
              <input type="radio" name="scope" value="page" checked={scope() === 'page'}
                onChange={() => setScope('page')} />
              Current page
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:default">
              <input type="radio" name="scope" value="document"  checked={scope() === 'document'}
                onChange={() => setScope('document')} />
              Entire document
            </label>
          </div>
        </div>

        <Show when={progress()}>
          <div style="font-size:11px;color:var(--theme-text-secondary,#888);padding:4px 0">
            {progress()}
          </div>
        </Show>

        <Show when={result()}>
          <div style="font-size:11px;color:#16a34a;padding:4px 0;background:#f0fdf4;border:1px solid #bbf7d0;padding:6px 8px;margin-top:4px">
            {result()}
          </div>
        </Show>

        <Show when={error()}>
          <div class="ai-login-error" style="margin-top:4px">{error()}</div>
        </Show>
      </div>
    </Dialog>
  );
}
