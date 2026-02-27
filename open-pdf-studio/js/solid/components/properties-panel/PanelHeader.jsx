import { storeClosePanel } from '../../stores/propertiesStore.js';
import { closePropertiesPanel } from '../../../ui/panels/properties-panel.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function PanelHeader() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');

  return (
    <div id="prop-panel-header" class="prop-panel-header">
      <h3 style="margin: 0; padding: 8px 0; background: none;">{t('title')}</h3>
      <button class="prop-panel-close-btn" title={tCommon('close')}
        onClick={() => closePropertiesPanel()}>&times;</button>
    </div>
  );
}
