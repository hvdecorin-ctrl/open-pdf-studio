import { Show, For, createMemo } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import ColorPalettePicker from './ColorPalettePicker.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { systemFontList } from '../../stores/fontStore.js';
import { ensureFontInStore } from '../../../utils/fonts.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

export default function TextFormatSection() {
  const { t } = useTranslation('properties');
  const isLocked = () => annotProps.locked;

  const fonts = createMemo(() => {
    const currentFont = annotProps.fontFamily;
    if (currentFont) {
      ensureFontInStore(currentFont);
    }
    return systemFontList();
  });

  return (
    <Show when={sectionVis.textFormat}>
      <CollapsibleSection title={t('textFormat.title')} name="textFormat" id="prop-text-format-section">
        <ColorPalettePicker
          label={t('textFormat.textColor')}
          color={() => annotProps.textColor}
          showNone={false}
          disabled={isLocked()}
          onColorChange={(color) => updateAnnotProp('textColor', color)}
        />

        <div class="property-group">
          <label>{t('textFormat.font')}</label>
          <select value={annotProps.fontFamily} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('fontFamily', e.target.value)}>
            <For each={fonts()}>
              {(font) => <option value={font} style={{ 'font-family': `'${font}', sans-serif` }}>{font}</option>}
            </For>
          </select>
        </div>

        <div class="property-group">
          <label>{t('textFormat.fontSize')}</label>
          <PrefComboBox
            value={() => annotProps.textFontSize}
            setValue={(val) => updateAnnotProp('textFontSize', val)}
            options={FONT_SIZE_OPTIONS}
            min={1} max={999} fallback={14} suffix="pt"
            disabled={isLocked}
          />
        </div>

        <div class="property-group">
          <label>{t('textFormat.style')}</label>
          <div class="text-style-buttons">
            <button type="button" class={`text-style-btn${annotProps.fontBold ? ' active' : ''}`}
              title={t('textFormat.bold')} disabled={isLocked()}
              onClick={() => updateAnnotProp('fontBold', !annotProps.fontBold)}>
              <strong>B</strong>
            </button>
            <button type="button" class={`text-style-btn${annotProps.fontItalic ? ' active' : ''}`}
              title={t('textFormat.italic')} disabled={isLocked()}
              onClick={() => updateAnnotProp('fontItalic', !annotProps.fontItalic)}>
              <em>I</em>
            </button>
            <button type="button" class={`text-style-btn${annotProps.fontUnderline ? ' active' : ''}`}
              title={t('textFormat.underline')} disabled={isLocked()}
              onClick={() => updateAnnotProp('fontUnderline', !annotProps.fontUnderline)}>
              <u>U</u>
            </button>
            <button type="button" class={`text-style-btn${annotProps.fontStrikethrough ? ' active' : ''}`}
              title={t('textFormat.strikethrough')} disabled={isLocked()}
              onClick={() => updateAnnotProp('fontStrikethrough', !annotProps.fontStrikethrough)}>
              <s>S</s>
            </button>
          </div>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
