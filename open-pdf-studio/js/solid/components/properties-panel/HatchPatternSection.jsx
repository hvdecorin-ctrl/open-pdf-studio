import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import ColorPalettePicker from './ColorPalettePicker.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function HatchPatternSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  return (
    <Show when={sectionVis.hatchPatternGroup}>
      <CollapsibleSection title={t('appearance.hatchPattern')} name="hatchPattern" id="prop-hatch-pattern-section">
        <div class="property-group">
          <label>{t('appearance.hatchPattern')}</label>
          <select value={annotProps.hatchPattern} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('hatchPattern', e.target.value)}>
            <Show when={annotProps.hatchPattern === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="none">{tCommon('none')}</option>
            <option value="diagonal-left">{t('appearance.hatchDiagonalLeft')}</option>
            <option value="diagonal-right">{t('appearance.hatchDiagonalRight')}</option>
            <option value="crosshatch">{t('appearance.hatchCrosshatch')}</option>
            <option value="horizontal">{t('appearance.hatchHorizontal')}</option>
            <option value="vertical">{t('appearance.hatchVertical')}</option>
            <option value="dots">{t('appearance.hatchDots')}</option>
            <option value="grid">{t('appearance.hatchGrid')}</option>
          </select>
        </div>
        <Show when={annotProps.hatchPattern && annotProps.hatchPattern !== 'none'}>
          <ColorPalettePicker
            label={t('appearance.hatchColor')}
            color={() => annotProps.hatchColor}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('hatchColor', color)}
          />
          <div class="property-group">
            <label>{t('appearance.hatchScale')}</label>
            <PrefComboBox
              value={() => annotProps.hatchScale}
              setValue={(val) => updateAnnotProp('hatchScale', val)}
              options={[50, 75, 100, 125, 150, 175, 200]}
              min={25} max={400} fallback={100} suffix="%"
              disabled={isLocked}
            />
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
