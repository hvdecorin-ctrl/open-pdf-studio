import { Show } from 'solid-js';
import { panelVisible, panelCollapsed, setPanelCollapsed, annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import PanelHeader from './PanelHeader.jsx';
import DocInfoView from './DocInfoView.jsx';
import GeneralSection from './GeneralSection.jsx';
import RepliesSection from './RepliesSection.jsx';
import AppearanceSection from './AppearanceSection.jsx';
import HatchPatternSection from './HatchPatternSection.jsx';
import LineEndingsSection from './LineEndingsSection.jsx';
import DimensionsSection from './DimensionsSection.jsx';
import MeasurementSection from './MeasurementSection.jsx';
import TextFormatSection from './TextFormatSection.jsx';
import ParagraphSection from './ParagraphSection.jsx';
import ContentSection from './ContentSection.jsx';
import ImageSection from './ImageSection.jsx';
import ActionsSection from './ActionsSection.jsx';
import CustomFieldsSection from './CustomFieldsSection.jsx';
import CollapsibleSection from './CollapsibleSection.jsx';

export default function PropertiesPanel() {
  const { t } = useTranslation('properties');

  function expandPanel() {
    setPanelCollapsed(false);
  }

  return (
    <Show when={panelVisible()}>
      <div class={`properties-panel-outer ${panelCollapsed() ? 'collapsed' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}>
        <Show when={panelCollapsed()}>
          <div class="properties-panel-collapsed-content" onClick={expandPanel}>
            <span class="properties-panel-collapsed-text">{t('title')}</span>
          </div>
        </Show>
        <Show when={!panelCollapsed()}>
          <div class="properties-panel visible" id="properties-panel">
            <PanelHeader />
            <DocInfoView />
            <GeneralSection />
            <RepliesSection />
            <AppearanceSection />
            <HatchPatternSection />
            <LineEndingsSection />
            <DimensionsSection />
            <MeasurementSection />
            <Show when={sectionVis.scaleBar}>
              <CollapsibleSection title={t('scaleBar.title')} name="scaleBar" id="prop-scalebar-section">
                <div class="property-group">
                  <label>{t('scaleBar.unit')}</label>
                  <select value={annotProps.scaleBarUnit}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onDblClick={cycleSelectNext}
                    onChange={(e) => updateAnnotProp('scaleBarUnit', e.target.value)}>
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                    <option value="in">in</option>
                    <option value="ft">ft</option>
                  </select>
                </div>
                <div class="property-group">
                  <label>{t('scaleBar.totalLength')}</label>
                  <input type="number" step="1" min="1"
                    value={annotProps.scaleBarTotalUnits}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleBarTotalUnits', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>{t('scaleBar.divisions')}</label>
                  <input type="number" step="1" min="1" max="20"
                    value={annotProps.scaleBarDivisions}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleBarDivisions', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>{t('scaleBar.barHeight')}</label>
                  <input type="number" step="1" min="4" max="100"
                    value={annotProps.scaleBarHeight}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleBarHeight', e.target.value)}
                  />
                </div>
              </CollapsibleSection>
            </Show>
            <TextFormatSection />
            <ParagraphSection />
            <ContentSection />
            <ImageSection />
            <CustomFieldsSection />
            <ActionsSection />
          </div>
        </Show>
      </div>
    </Show>
  );
}
