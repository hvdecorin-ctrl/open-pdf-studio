import { createSignal, Switch, Match, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { DEFAULT_PREFERENCES } from '../../../core/constants.js';
import { state } from '../../../core/state.js';
import { savePreferences, applyTheme } from '../../../core/preferences.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { isMobile } from '../../../core/platform.js';

import GeneralTab from './GeneralTab.jsx';
import AnnotationsTab from './AnnotationsTab.jsx';
import DrawingTab from './DrawingTab.jsx';
import ShapesTab from './ShapesTab.jsx';
import MarkupTab from './MarkupTab.jsx';
import BehaviorTab from './BehaviorTab.jsx';
import FileAssocTab from './FileAssocTab.jsx';
import VirtualPrinterTab from './VirtualPrinterTab.jsx';

const DESKTOP_ONLY_TABS = ['fileassoc', 'vprinter'];

const TAB_IDS = [
  { id: 'general', key: 'tabs.general' },
  { id: 'annotations', key: 'tabs.annotations' },
  { id: 'drawing', key: 'tabs.drawing' },
  { id: 'shapes', key: 'tabs.shapes' },
  { id: 'markup', key: 'tabs.markup' },
  { id: 'behavior', key: 'tabs.behavior' },
  { id: 'fileassoc', key: 'tabs.fileAssociation' },
  { id: 'vprinter', key: 'tabs.virtualPrinter' },
];

function createPrefSignals(source) {
  const signals = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES)) {
    const val = source[key] !== undefined ? source[key] : DEFAULT_PREFERENCES[key];
    signals[key] = createSignal(val);
  }
  return signals;
}

export default function PreferencesDialog(props) {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const initialTab = props.data?.tab || 'general';
  const [activeTab, setActiveTab] = createSignal(initialTab);

  const prefs = createPrefSignals(state.preferences);

  function close() {
    closeDialog('preferences');
  }

  function handleSave() {
    for (const key of Object.keys(DEFAULT_PREFERENCES)) {
      state.preferences[key] = prefs[key][0]();
    }
    savePreferences();
    applyTheme(state.preferences.theme);
    close();
  }

  function handleReset() {
    if (confirm(t('resetConfirm'))) {
      for (const key of Object.keys(DEFAULT_PREFERENCES)) {
        prefs[key][1](DEFAULT_PREFERENCES[key]);
      }
    }
  }

  const footer = (
    <>
      <button class="pref-btn pref-btn-secondary" onClick={handleReset}>{t('resetToDefaults')}</button>
      <div class="pref-footer-right">
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
        <button class="pref-btn pref-btn-primary" onClick={handleSave}>{tCommon('save')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('title')}
      overlayClass="preferences-overlay"
      dialogClass="preferences-dialog"
      headerClass="preferences-header"
      bodyClass="preferences-body-wrapper"
      footerClass="preferences-footer"
      onClose={close}
      footer={footer}
    >
      <div class="preferences-content">
        <div class="pref-tabs">
          <For each={isMobile() ? TAB_IDS.filter(t => !DESKTOP_ONLY_TABS.includes(t.id)) : TAB_IDS}>
            {(tab) => (
              <button
                class="pref-tab"
                classList={{ active: activeTab() === tab.id }}
                onClick={() => setActiveTab(tab.id)}
              >
                {t(tab.key)}
              </button>
            )}
          </For>
        </div>

        <div class="pref-tab-content active">
          <Switch>
            <Match when={activeTab() === 'general'}>
              <GeneralTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'annotations'}>
              <AnnotationsTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'drawing'}>
              <DrawingTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'shapes'}>
              <ShapesTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'markup'}>
              <MarkupTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'behavior'}>
              <BehaviorTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'fileassoc'}>
              <FileAssocTab />
            </Match>
            <Match when={activeTab() === 'vprinter'}>
              <VirtualPrinterTab />
            </Match>
          </Switch>
        </div>
      </div>
    </Dialog>
  );
}
