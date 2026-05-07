import { createSignal } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { colorPickerValue, setColorPickerValue, lineWidthValue, setLineWidthValue } from '../../stores/ribbonStore.js';
import { setTool } from '../../../tools/manager.js';
import { state, getActiveDocument, noPdf } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { recordClearPage, recordClearAll, recordAdd } from '../../../core/undo-manager.js';
import { hideProperties } from '../../../ui/panels/properties-panel.js';
import { clearSelection } from '../../../core/stores/selection-helpers.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import {
  highlightIcon, freehandIcon, lineIcon, arrowIcon, polylineIcon,
  rectIcon, ellipseIcon, polygonIcon, cloudIcon, cloudPolylineIcon,
  textAnnotIcon, textboxIcon, noteIcon, calloutIcon,
  stampIcon, signatureIcon,
  redactionIcon, applyRedactionsIcon,
  clearPageIcon, clearAllIcon,
  measureDistanceIcon, measureAreaIcon, measurePerimeterIcon, measureAngleIcon, calibrateIcon
} from '../../data/ribbonIcons.js';

import { useTranslation } from '../../../i18n/useTranslation.js';
import { setPickerOpen as setParametricPickerOpen } from '../../stores/parametricSymbolStore.js';
import { savePreferences } from '../../../core/preferences.js';
import { toggleSchedule, scheduleVisible } from '../../stores/scheduleStore.js';
import { createFullPageScaleRegion, invalidateScaleRegionCache } from '../../../annotations/scale-region.js';
import { openDialog } from '../../../bridge.js';
import { isDynamicScalingEnabled, setDynamicScalingEnabled } from '../../../annotations/dynamic-scaling.js';
import PrefSelect from '../preferences/PrefSelect.jsx';

const scheduleIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1.5" stroke-width="1.5"/><line x1="3" y1="8" x2="21" y2="8" stroke-width="1.5"/><line x1="3" y1="13" x2="21" y2="13" stroke-width="1"/><line x1="3" y1="18" x2="21" y2="18" stroke-width="1"/><line x1="9" y1="8" x2="9" y2="21" stroke-width="1"/><line x1="15" y1="8" x2="15" y2="21" stroke-width="1"/></svg>`;

export default function CommentTab() {
  const { t } = useTranslation('ribbon');

  return (
    <div class="ribbon-content active" id="tab-comment">
      <AdaptiveGroups>
        {/* Drawing tools (line/arrow/polyline/arc/spline/rect/ellipse/polygon/cloud/cloudPolyline/filledArea/freehand)
            were moved to the dedicated Drawing tab. Comment tab keeps only
            comment-style annotations (highlight, callout, note, stamp, etc.). */}
        <RibbonGroup label={t('comment.drawing')}>
          <RibbonButton id="tool-highlight" title={t('comment.highlight')} icon={highlightIcon} label={t('comment.highlight')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'highlight'} onClick={() => setTool('highlight')} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.text')}>
          <RibbonButton id="tool-textbox" title={t('comment.textBox')} icon={textboxIcon} label={t('comment.textBox')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'textbox'} onClick={() => setTool('textbox')} />
          <RibbonButton id="tool-callout" title={t('comment.callout')} icon={calloutIcon} label={t('comment.callout')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'callout'} onClick={() => setTool('callout')} />
          <RibbonButton id="tool-comment" title={t('comment.note')} icon={noteIcon} label={t('comment.note')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'comment'} onClick={() => setTool('comment')} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.stamp')}>
          <RibbonButton id="tool-stamp" title={t('comment.stamp')} icon={stampIcon} label={t('comment.stamp')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'stamp'} onClick={() => setTool('stamp')} />
          <RibbonButton id="tool-signature" title={t('comment.signature')} icon={signatureIcon} label={t('comment.signature')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'signature'} onClick={() => setTool('signature')} />
          <RibbonButton id="tool-parametric-symbol" title="Parametrisch symbool"
            icon={stampIcon} label="Parametrisch"
            disabled={noPdf() || isPdfAReadOnly()}
            active={state.currentTool === 'parametricSymbol'}
            onClick={() => setParametricPickerOpen(true)} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.redaction')}>
          <RibbonButton id="tool-redaction" title={t('comment.markForRedaction')} icon={redactionIcon} label={t('comment.redact')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'redaction'} onClick={() => setTool('redaction')} />
          <RibbonButton id="btn-apply-redactions" title={t('comment.applyRedactions')} icon={applyRedactionsIcon} label={t('comment.applyLabel')}
            disabled={noPdf() || isPdfAReadOnly()} iconStyle={{ color: '#dc2626' }}
            onClick={async () => {
              const { applyRedactions } = await import('../../../annotations/redaction.js');
              await applyRedactions();
            }} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.properties')}>
          <RibbonButtonStack>
            <div class="ribbon-input-row">
              <label class="ribbon-input-label">{t('comment.color')}</label>
              <input type="color" id="color-picker" class="ribbon-color-input"
                value={colorPickerValue()}
                disabled={noPdf() || isPdfAReadOnly()}
                onInput={(e) => setColorPickerValue(e.target.value)} />
            </div>
            <div class="ribbon-input-row">
              <label class="ribbon-input-label">{t('comment.width')}</label>
              <input type="number" id="line-width" class="ribbon-input" min="1" max="20"
                value={lineWidthValue()}
                disabled={noPdf() || isPdfAReadOnly()}
                onInput={(e) => setLineWidthValue(parseInt(e.target.value) || 3)} />
            </div>
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('comment.edit')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-clear" title={t('comment.clearPageAnnotations')} icon={clearPageIcon} label={t('comment.clearPage')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={async () => {
                let confirmed = false;
                if (window.__TAURI__?.dialog?.ask) {
                  confirmed = await window.__TAURI__.dialog.ask(t('comment.clearPageConfirm'), { title: t('comment.clearPage'), kind: 'warning' });
                } else {
                  confirmed = confirm(t('comment.clearPageConfirm'));
                }
                if (confirmed) {
                  const cpDoc = getActiveDocument();
                  const cpPage = cpDoc ? cpDoc.currentPage : 1;
                  recordClearPage(cpPage, cpDoc?.annotations || []);
                  if (cpDoc) cpDoc.annotations = cpDoc.annotations.filter(a => a.page !== cpPage);
                  clearSelection();
                  hideProperties();
                  if (getActiveDocument()?.viewMode === 'continuous') { redrawContinuous(); } else { redrawAnnotations(); }
                }
              }} />
            <RibbonButton size="small" id="ribbon-clear-all" title={t('comment.clearAllAnnotations')} icon={clearAllIcon} label={t('comment.clearAll')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={async () => {
                const caDoc = getActiveDocument();
                if (!caDoc || caDoc.annotations.length === 0) return;
                const confirmed = await window.__TAURI__?.dialog?.ask(t('comment.clearAllConfirm'), { title: t('comment.clearAll'), kind: 'warning' });
                if (confirmed) {
                  recordClearAll(caDoc.annotations);
                  caDoc.annotations = [];
                  clearSelection();
                  hideProperties();
                  if (getActiveDocument()?.viewMode === 'continuous') { redrawContinuous(); } else { redrawAnnotations(); }
                }
              }} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('measure.tools') || 'METEN'}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-distance" title={t('measure.measureDistance') || 'Afstand meten'} icon={measureDistanceIcon} label={t('measure.distance') || 'Afstand'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureDistance'} onClick={() => setTool('measureDistance')} />
            <RibbonButton size="small" id="tool-measure-area" title={t('measure.measureArea') || 'Oppervlakte meten'} icon={measureAreaIcon} label={t('measure.area') || 'Oppervlakte'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureArea'} onClick={() => setTool('measureArea')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-perimeter" title={t('measure.measurePerimeter') || 'Omtrek meten'} icon={measurePerimeterIcon} label={t('measure.perimeter') || 'Omtrek'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measurePerimeter'} onClick={() => setTool('measurePerimeter')} />
            <RibbonButton size="small" id="tool-measure-angle" title={t('measure.measureAngle') || 'Hoek meten'} icon={measureAngleIcon} label={t('measure.angle') || 'Hoek'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureAngle'} onClick={() => setTool('measureAngle')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('measure.scaleGroup') || 'Schaal'}>
          <RibbonButton id="btn-create-scale-region"
            title={t('comment.scaleRegion') || 'Draw a scale region with its own calibration'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" stroke-dasharray="3 2"/><text x="12" y="16" font-size="8" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1:N</text></svg>`}
            label={t('comment.scaleRegion') || 'Scale region'}
            disabled={noPdf() || isPdfAReadOnly()}
            active={state.currentTool === 'scaleRegion'}
            onClick={() => setTool('scaleRegion')} />
          <RibbonButton id="btn-create-scale-region-full-page"
            title={t('comment.scaleRegionFullPageTitle') || 'Place a scale region covering the whole page'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" stroke-dasharray="2 2"/><text x="12" y="15" font-size="7" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1:N</text></svg>`}
            label={t('comment.scaleRegionFullPage') || 'Schaalgebied op pagina'}
            disabled={noPdf() || isPdfAReadOnly()}
            onClick={() => {
              const ann = createFullPageScaleRegion();
              if (!ann) return;
              invalidateScaleRegionCache();
              const doc = getActiveDocument();
              if (doc?.viewMode === 'continuous') redrawContinuous();
              else redrawAnnotations();
              openDialog('scale-region', { annotationId: ann.id, pageNum: ann.page });
            }} />
          <RibbonButtonStack>
            <label style={{ display: 'flex', 'align-items': 'center', gap: '4px', 'font-size': '10px', color: 'var(--theme-text-secondary, #888)', padding: '2px 4px', cursor: 'default' }}>
              <input type="checkbox"
                checked={isDynamicScalingEnabled()}
                onChange={(e) => { setDynamicScalingEnabled(e.target.checked); savePreferences(); }}
                style={{ margin: 0 }} />
              {t('measure.dynamicScaling') || 'Auto-scale markups'}
            </label>
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('measure.schedule') || 'TAKE-OFF'}>
          <RibbonButton id="btn-open-schedule"
            title={t('measure.openSchedule') || 'Take-Off'}
            icon={scheduleIcon}
            label={t('measure.takeOff') || 'Take-Off'}
            disabled={noPdf()}
            active={scheduleVisible()}
            onClick={toggleSchedule} />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
