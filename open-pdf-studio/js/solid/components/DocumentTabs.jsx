import { For, Show } from 'solid-js';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';

function handleTabClick(index) {
  import('../../ui/chrome/tabs.js').then(m => m.switchToTab(index));
}

function handleCloseTab(e, index) {
  e.stopPropagation();
  import('../../ui/chrome/tabs.js').then(m => m.closeTab(index));
}

function handleMiddleClick(e, index) {
  if (e.button === 1) {
    e.preventDefault();
    import('../../ui/chrome/tabs.js').then(m => m.closeTab(index));
  }
}

function handleAddClick() {
  import('../../pdf/loader.js').then(m => m.openPDFFile());
}

export default function DocumentTabs() {
  const { t } = useTranslation('statusbar');

  return (
    <div class="document-tabs" id="document-tabs">
      <Show when={state.documents.length === 0}>
        <div class="document-tabs-empty">{t('noDocumentsOpen')}</div>
      </Show>

      <For each={state.documents}>
        {(doc, i) => (
          <div
            class={'document-tab' + (i() === state.activeDocumentIndex ? ' active' : '')}
            data-index={i()}
            onClick={() => handleTabClick(i())}
            onAuxClick={(e) => handleMiddleClick(e, i())}
          >
            <span class="document-tab-modified">{doc.modified ? '*' : ''}</span>
            <span class="document-tab-title" title={doc.filePath || doc.fileName}>{doc.fileName}</span>
            <span class="document-tab-close" title={t('closeTab')} onClick={(e) => handleCloseTab(e, i())}>&times;</span>
          </div>
        )}
      </For>

      <div class="document-tabs-add" title={t('openPdfFile')} onClick={handleAddClick}>+</div>
    </div>
  );
}
