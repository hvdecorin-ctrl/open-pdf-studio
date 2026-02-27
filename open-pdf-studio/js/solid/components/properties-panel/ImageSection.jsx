import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, resetImageSize, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function ImageSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.image}>
      <CollapsibleSection title={t('image.title')} name="image" id="prop-image-section">
        <div class="property-group">
          <label>{t('image.width')}</label>
          <input type="number" min="20" max="2000"
            value={annotProps.imageWidth} disabled={isLocked()}
            onInput={(e) => updateAnnotProp('imageWidth', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('image.height')}</label>
          <input type="number" min="20" max="2000"
            value={annotProps.imageHeight} disabled={isLocked()}
            onInput={(e) => updateAnnotProp('imageHeight', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('image.lockAspectRatio')}</label>
          <select value={annotProps.lockAspectRatio ? 'yes' : 'no'}
            disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('lockAspectRatio', e.target.value === 'yes')}>
            <option value="no">{tCommon('no')}</option>
            <option value="yes">{tCommon('yes')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('image.rotation')}</label>
          <PrefComboBox
            value={() => annotProps.imageRotation}
            setValue={(val) => updateAnnotProp('imageRotation', val)}
            options={[0, 45, 90, 135, 180, 225, 270, 315]}
            min={-360} max={360} fallback={0} suffix="°"
            disabled={isLocked}
          />
        </div>

        <div class="property-group">
          <label></label>
          <button type="button" class="prop-action-btn"
            disabled={isLocked()}
            onClick={() => resetImageSize()}>
            {t('image.resetToOriginal')}
          </button>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
