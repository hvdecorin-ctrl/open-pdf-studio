import { Show } from 'solid-js';
import { annotProps, sectionVis } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function DimensionsSection() {
  const { t } = useTranslation('properties');

  return (
    <Show when={sectionVis.dimensions}>
      <CollapsibleSection title={t('dimensions.title')} name="dimensions" id="prop-dimensions-section">
        <div class="property-group">
          <label>{t('dimensions.length')}</label>
          <input type="text" value={annotProps.arrowLength} readonly />
        </div>
      </CollapsibleSection>
    </Show>
  );
}
