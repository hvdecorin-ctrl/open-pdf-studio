import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function ParagraphSection() {
  const { t } = useTranslation('properties');
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.paragraph}>
      <CollapsibleSection title={t('paragraph.title')} name="paragraph" id="prop-paragraph-section">
        <div class="property-group">
          <label>{t('paragraph.textAlignment')}</label>
          <div class="text-align-buttons">
            <button type="button"
              class={`text-align-btn${annotProps.textAlign === 'left' ? ' active' : ''}`}
              title={t('paragraph.alignLeft')} disabled={isLocked()}
              onClick={() => updateAnnotProp('textAlign', 'left')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M3 12h12M3 18h18"/>
              </svg>
            </button>
            <button type="button"
              class={`text-align-btn${annotProps.textAlign === 'center' ? ' active' : ''}`}
              title={t('paragraph.alignCenter')} disabled={isLocked()}
              onClick={() => updateAnnotProp('textAlign', 'center')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M6 12h12M3 18h18"/>
              </svg>
            </button>
            <button type="button"
              class={`text-align-btn${annotProps.textAlign === 'right' ? ' active' : ''}`}
              title={t('paragraph.alignRight')} disabled={isLocked()}
              onClick={() => updateAnnotProp('textAlign', 'right')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M9 12h12M3 18h18"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="property-group">
          <label>{t('paragraph.lineSpacing')}</label>
          <select value={annotProps.lineSpacing} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('lineSpacing', e.target.value)}>
            <option value="1">1x</option>
            <option value="1.15">1.15x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
            <option value="2.5">2.5x</option>
            <option value="3">3x</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('paragraph.rotation')}</label>
          <PrefComboBox
            value={() => annotProps.rotation}
            setValue={(val) => updateAnnotProp('rotation', val)}
            options={[0, 45, 90, 135, 180, 225, 270, 315]}
            min={-360} max={360} fallback={0} suffix="°"
            disabled={isLocked}
          />
        </div>
      </CollapsibleSection>
    </Show>
  );
}
