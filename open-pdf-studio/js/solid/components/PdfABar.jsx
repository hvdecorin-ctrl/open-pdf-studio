import { Show } from 'solid-js';
import { visible, labelText, hidePdfABar } from '../stores/pdfaBarStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';

export default function PdfABar() {
  const { t } = useTranslation('statusbar');
  const { t: tCommon } = useTranslation('common');

  const handleDismiss = () => {
    import('../../pdf/loader.js').then(m => m.dismissPdfAForActiveDoc());
  };

  return (
    <Show when={visible()}>
      <div class="pdfa-bar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1.5L1 14h14L8 1.5zm0 2.5l5.2 9H2.8L8 4zm-.5 4v3h1V8h-1zm0 4v1h1v-1h-1z" fill="currentColor"/>
        </svg>
        <span>{labelText()}</span>
        <button class="pdfa-bar-action" onClick={handleDismiss}>{t('enableEditing')}</button>
        <button class="pdfa-bar-close" onClick={handleDismiss} title={tCommon('close')}>&times;</button>
      </div>
    </Show>
  );
}
