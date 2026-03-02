import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function LineEndingsSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  return (
    <Show when={sectionVis.lineEndings}>
      <CollapsibleSection title={t('lineEndings.title')} name="lineEndings" id="prop-line-endings-section">
        <div class="property-group">
          <label>{t('lineEndings.start')}</label>
          <select value={annotProps.startHead} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('startHead', e.target.value)}>
            <Show when={annotProps.startHead === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="none">{tCommon('none')}</option>
            <option value="open">{t('lineEndings.openArrow')}</option>
            <option value="closed">{t('lineEndings.closedArrow')}</option>
            <option value="diamond">{t('lineEndings.diamond')}</option>
            <option value="circle">{t('lineEndings.circle')}</option>
            <option value="square">{t('lineEndings.square')}</option>
            <option value="slash">{t('lineEndings.slash')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('lineEndings.end')}</label>
          <select value={annotProps.endHead} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('endHead', e.target.value)}>
            <Show when={annotProps.endHead === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="none">{tCommon('none')}</option>
            <option value="open">{t('lineEndings.openArrow')}</option>
            <option value="closed">{t('lineEndings.closedArrow')}</option>
            <option value="diamond">{t('lineEndings.diamond')}</option>
            <option value="circle">{t('lineEndings.circle')}</option>
            <option value="square">{t('lineEndings.square')}</option>
            <option value="slash">{t('lineEndings.slash')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('lineEndings.headSize')}</label>
          <input type="number" min="4" max="40"
            value={annotProps.headSize === 'mixed' ? '' : annotProps.headSize}
            placeholder={annotProps.headSize === 'mixed' ? tCommon('mixed') : undefined}
            disabled={isLocked()}
            onInput={(e) => updateAnnotProp('headSize', e.target.value)} />
        </div>
      </CollapsibleSection>
    </Show>
  );
}
