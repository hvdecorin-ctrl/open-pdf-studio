import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, getLineWidthLabel, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import ColorPalettePicker from './ColorPalettePicker.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function AppearanceSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.appearance}>
      <CollapsibleSection title={t('appearance.title')} name="appearance" id="prop-appearance-section">
        <Show when={sectionVis.iconGroup}>
          <div class="property-group">
            <label>{t('appearance.icon')}</label>
            <select value={annotProps.icon} disabled={isLocked()}
              onDblClick={cycleSelectNext}
              onChange={(e) => updateAnnotProp('icon', e.target.value)}>
              <option value="comment">{t('appearance.iconComment')}</option>
              <option value="note">{t('appearance.iconNote')}</option>
              <option value="help">{t('appearance.iconHelp')}</option>
              <option value="insert">{t('appearance.iconInsert')}</option>
              <option value="key">{t('appearance.iconKey')}</option>
              <option value="newparagraph">{t('appearance.iconNewParagraph')}</option>
              <option value="paragraph">{t('appearance.iconParagraph')}</option>
              <option value="check">{t('appearance.iconCheck')}</option>
              <option value="circle">{t('appearance.iconCircle')}</option>
              <option value="cross">{t('appearance.iconCross')}</option>
              <option value="star">{t('appearance.iconStar')}</option>
            </select>
          </div>
        </Show>

        <Show when={sectionVis.fillColorGroup}>
          <ColorPalettePicker
            label={t('appearance.fillColor')}
            color={() => annotProps.fillColor}
            showNone={true}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('fillColor', color)}
            onNone={() => updateAnnotProp('fillColor', null)}
          />
        </Show>

        <Show when={sectionVis.strokeColorGroup}>
          <ColorPalettePicker
            label={t('appearance.strokeColor')}
            color={() => annotProps.strokeColor}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('strokeColor', color)}
          />
        </Show>

        <Show when={sectionVis.colorGroup}>
          <ColorPalettePicker
            label={t('appearance.color')}
            color={() => annotProps.color}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('color', color)}
          />
        </Show>

        <Show when={sectionVis.opacityGroup}>
          <div class="property-group">
            <label>{t('appearance.opacity')}</label>
            <PrefComboBox
              value={() => annotProps.opacity}
              setValue={(val) => updateAnnotProp('opacity', val)}
              options={[100, 90, 80, 70, 60, 50, 40, 30, 20, 10]}
              min={0} max={100} fallback={100} suffix="%"
              disabled={isLocked}
            />
          </div>
        </Show>

        <Show when={sectionVis.lineWidthGroup}>
          <div class="property-group">
            <label>{getLineWidthLabel()}</label>
            <PrefComboBox
              value={() => annotProps.lineWidth}
              setValue={(val) => updateAnnotProp('lineWidth', val)}
              options={[0, 0.5, 1, 2, 3, 4, 6, 8, 10, 12]}
              min={0} max={20} fallback={1} suffix="pt"
              disabled={isLocked}
            />
          </div>
        </Show>

        <Show when={sectionVis.borderStyleGroup}>
          <div class="property-group">
            <label>{t('appearance.borderStyle')}</label>
            <select value={annotProps.borderStyle} disabled={isLocked()}
              onDblClick={cycleSelectNext}
              onChange={(e) => updateAnnotProp('borderStyle', e.target.value)}>
              <option value="solid">{tCommon('solid')}</option>
              <option value="dashed">{tCommon('dashed')}</option>
              <option value="dotted">{tCommon('dotted')}</option>
            </select>
          </div>
        </Show>

        <Show when={sectionVis.rotationGroup}>
          <div class="property-group">
            <label>{t('appearance.rotation')}</label>
            <PrefComboBox
              value={() => annotProps.rotation}
              setValue={(val) => updateAnnotProp('rotation', val)}
              options={[0, 45, 90, 135, 180, 225, 270, 315]}
              min={-360} max={360} fallback={0} suffix="°"
              disabled={isLocked}
            />
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
