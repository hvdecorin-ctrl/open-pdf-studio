import { Show, createSignal, createMemo } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { setTool } from '../../../tools/manager.js';
import { state, noPdf, getActiveDocument } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { calibrationPixelDistance, setCalibrationPixelDistance, setActiveTab } from '../../stores/ribbonStore.js';
import { getMeasureScale, recalculateAllMeasurements, saveDocumentScale } from '../../../annotations/measurement.js';
import { savePreferences } from '../../../core/preferences.js';
import {
  measureDistanceIcon, measureAreaIcon, measurePerimeterIcon, measureAngleIcon, calibrateIcon
} from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { toggleSchedule, scheduleVisible } from '../../stores/scheduleStore.js';
import { detectScaleFromPdf } from '../../../annotations/scale-bar.js';

const selectPointsIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="19" r="2.5" stroke-width="2"/><circle cx="19" cy="5" r="2.5" stroke-width="2"/><path stroke-linecap="round" stroke-dasharray="4 3" stroke-width="1.5" d="M7 17L17 7"/></svg>`;

const autoDetectIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke-width="2"/><path stroke-linecap="round" stroke-width="2" d="M16 16l5 5"/><text x="7" y="14" font-size="8" fill="currentColor" stroke="none" font-weight="bold">A</text></svg>`;

const scaleBarIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="14" width="20" height="4" stroke-width="1.5" rx="0.5"/><rect x="2" y="14" width="4" height="4" fill="currentColor" stroke="none"/><rect x="10" y="14" width="4" height="4" fill="currentColor" stroke="none"/><rect x="18" y="14" width="4" height="4" fill="currentColor" stroke="none"/><path stroke-width="1" d="M2 20v-1M6 20v-1M10 20v-1M14 20v-1M18 20v-1M22 20v-1"/><text x="2" y="23" font-size="3" fill="currentColor">0</text></svg>`;

const scheduleIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1.5" stroke-width="1.5"/><line x1="3" y1="8" x2="21" y2="8" stroke-width="1.5"/><line x1="3" y1="13" x2="21" y2="13" stroke-width="1"/><line x1="3" y1="18" x2="21" y2="18" stroke-width="1"/><line x1="9" y1="8" x2="9" y2="21" stroke-width="1"/><line x1="15" y1="8" x2="15" y2="21" stroke-width="1"/></svg>`;

export default function MeasureTab() {
  const { t } = useTranslation('ribbon');

  const [calibValue, setCalibValue] = createSignal('');
  const [calibUnit, setCalibUnit] = createSignal('mm');
  const [autoDetectStatus, setAutoDetectStatus] = createSignal('');  // '', 'detecting', 'found', 'notfound'

  const currentScale = createMemo(() => {
    const doc = getActiveDocument();
    const ms = doc?.measureScale;
    if (ms && ms.pixelsPerUnit > 0) {
      if (ms.scaleRatio) return ms.scaleRatio;
      return `1px = ${(1 / ms.pixelsPerUnit).toFixed(4)} ${ms.unit}`;
    }
    return null;
  });

  function handleSelectPoints() {
    setCalibrationPixelDistance(null);
    setTool('calibrationPick');
  }

  function handleApply() {
    const pixelDist = calibrationPixelDistance();
    const realValue = parseFloat(calibValue());
    const unit = calibUnit();

    if (!pixelDist || pixelDist <= 0 || !realValue || realValue <= 0) return;

    const pixelsPerUnit = pixelDist / realValue;
    const doc = getActiveDocument();
    if (!doc) return;

    doc.measureScale = { pixelsPerUnit, unit, method: 'reference', scaleRatio: 0 };
    saveDocumentScale();

    // Update default preferences for future measurements
    const scaleVal = realValue / pixelDist;
    state.preferences.measureDistDimScale = scaleVal;
    state.preferences.measureDistDimUnit = unit;
    state.preferences.measureAreaDimScale = scaleVal;
    state.preferences.measureAreaDimUnit = unit;
    state.preferences.measurePerimDimScale = scaleVal;
    state.preferences.measurePerimDimUnit = unit;
    savePreferences();

    recalculateAllMeasurements();

    // Reset
    setCalibrationPixelDistance(null);
    setCalibValue('');
  }

  async function handleAutoDetect() {
    setAutoDetectStatus('detecting');
    try {
      const result = await detectScaleFromPdf();
      if (result && result.ratio > 0) {
        const doc = getActiveDocument();
        if (!doc) { setAutoDetectStatus(''); return; }

        // At scale 1:ratio, 1 PDF unit (= 1/72 inch) represents (25.4/72 * ratio) mm in reality.
        // pixelsPerUnit = PDF units per real-world mm = 72 / (25.4 * ratio)
        const pixelsPerUnit = 72 / (25.4 * result.ratio);

        doc.measureScale = {
          pixelsPerUnit,
          unit: 'mm',
          method: 'auto-detect',
          scaleRatio: `1:${result.ratio}`,
        };
        saveDocumentScale();

        // Update default preferences
        const scaleVal = 1 / pixelsPerUnit;
        state.preferences.measureDistDimScale = scaleVal;
        state.preferences.measureDistDimUnit = 'mm';
        state.preferences.measureAreaDimScale = scaleVal;
        state.preferences.measureAreaDimUnit = 'mm';
        state.preferences.measurePerimDimScale = scaleVal;
        state.preferences.measurePerimDimUnit = 'mm';
        savePreferences();

        recalculateAllMeasurements();
        setAutoDetectStatus('found');
      } else {
        setAutoDetectStatus('notfound');
      }
    } catch (e) {
      console.error('Auto-detect scale error:', e);
      setAutoDetectStatus('notfound');
    }
    // Clear status after 3 seconds
    setTimeout(() => setAutoDetectStatus(''), 3000);
  }

  return (
    <div class="ribbon-content active" id="tab-measure">
      <div class="ribbon-groups">

        <RibbonGroup label={t('measure.scale') || 'SCHAAL'}>
          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '2px 4px' }}>
            <RibbonButton id="btn-select-points"
              title={t('measure.selectPointsTitle') || 'Selecteer 2 referentiepunten op de tekening'}
              icon={selectPointsIcon}
              label={t('measure.selectPoints') || 'Selecteer punten'}
              disabled={noPdf()}
              active={state.currentTool === 'calibrationPick'}
              onClick={handleSelectPoints} />

            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '3px', 'min-width': '160px' }}>
              <Show when={calibrationPixelDistance()}>
                <span style={{ 'font-size': '10px', color: '#aaa' }}>
                  {t('measure.pixelDistance') || 'Pixelafstand'}: {calibrationPixelDistance()?.toFixed(1)} px
                </span>
              </Show>

              <div style={{ display: 'flex', gap: '4px', 'align-items': 'center' }}>
                <input
                  type="number"
                  placeholder={t('measure.enterDistance') || 'Maat...'}
                  value={calibValue()}
                  onInput={(e) => setCalibValue(e.target.value)}
                  disabled={!calibrationPixelDistance()}
                  style={{
                    width: '70px', height: '22px', 'font-size': '11px',
                    background: '#333', color: '#eee', border: '1px solid #555',
                    'border-radius': '3px', padding: '0 4px'
                  }}
                />
                <select
                  value={calibUnit()}
                  onChange={(e) => setCalibUnit(e.target.value)}
                  disabled={!calibrationPixelDistance()}
                  style={{
                    height: '22px', 'font-size': '11px',
                    background: '#333', color: '#eee', border: '1px solid #555',
                    'border-radius': '3px'
                  }}
                >
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                  <option value="in">in</option>
                  <option value="ft">ft</option>
                </select>
              </div>

              <button
                onClick={handleApply}
                disabled={!calibrationPixelDistance() || !calibValue() || parseFloat(calibValue()) <= 0}
                style={{
                  height: '22px', 'font-size': '11px', cursor: 'pointer',
                  background: calibrationPixelDistance() && calibValue() ? '#e67e22' : '#444',
                  color: '#fff', border: 'none', 'border-radius': '3px',
                  opacity: (!calibrationPixelDistance() || !calibValue()) ? 0.5 : 1
                }}
              >
                {t('measure.apply') || 'Toepassen'}
              </button>
            </div>

            <Show when={currentScale()}>
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px', 'margin-left': '8px', 'border-left': '1px solid #555', 'padding-left': '8px' }}>
                <span style={{ 'font-size': '9px', color: '#888' }}>{t('measure.currentScale') || 'Huidige schaal'}</span>
                <span style={{ 'font-size': '11px', color: '#ccc' }}>{currentScale()}</span>
              </div>
            </Show>

            <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '2px', 'margin-left': '8px', 'border-left': '1px solid #555', 'padding-left': '8px' }}>
              <RibbonButton id="btn-auto-detect-scale"
                title={t('measure.autoDetectTitle') || 'Detect scale from title block text'}
                icon={autoDetectIcon}
                label={t('measure.autoDetect') || 'Auto-detect'}
                disabled={noPdf() || autoDetectStatus() === 'detecting'}
                onClick={handleAutoDetect} />
              <Show when={autoDetectStatus() === 'found'}>
                <span style={{ 'font-size': '9px', color: '#2ecc71' }}>{t('measure.scaleDetected') || 'Scale detected'}</span>
              </Show>
              <Show when={autoDetectStatus() === 'notfound'}>
                <span style={{ 'font-size': '9px', color: '#e74c3c' }}>{t('measure.noScaleFound') || 'No scale found'}</span>
              </Show>
              <Show when={autoDetectStatus() === 'detecting'}>
                <span style={{ 'font-size': '9px', color: '#f39c12' }}>{t('measure.detecting') || 'Detecting...'}</span>
              </Show>
            </div>
          </div>
        </RibbonGroup>

        <RibbonGroup label={t('measure.tools') || 'METEN'}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-distance" title={t('measure.measureDistance') || 'Afstand meten'} icon={measureDistanceIcon} label={t('measure.distance') || 'Afstand'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureDistance'} onClick={() => setTool('measureDistance')} />
            <RibbonButton size="small" id="tool-measure-area" title={t('measure.measureArea') || 'Oppervlakte meten'} icon={measureAreaIcon} label={t('measure.area') || 'Oppervlakte'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureArea'} onClick={() => setTool('measureArea')} />
            <RibbonButton size="small" id="tool-measure-perimeter" title={t('measure.measurePerimeter') || 'Omtrek meten'} icon={measurePerimeterIcon} label={t('measure.perimeter') || 'Omtrek'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measurePerimeter'} onClick={() => setTool('measurePerimeter')} />
            <RibbonButton size="small" id="tool-measure-angle" title={t('measure.measureAngle') || 'Hoek meten'} icon={measureAngleIcon} label={t('measure.angle') || 'Hoek'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureAngle'} onClick={() => setTool('measureAngle')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('measure.scaleBar') || 'SCHAALSTOK'}>
          <RibbonButton id="btn-place-scalebar"
            title={t('measure.placeScaleBar') || 'Schaalstok plaatsen'}
            icon={scaleBarIcon}
            label={t('measure.placeScaleBar') || 'Schaalstok'}
            disabled={noPdf() || isPdfAReadOnly()}
            active={state.currentTool === 'scaleBar'}
            onClick={() => setTool('scaleBar')} />
        </RibbonGroup>

        <RibbonGroup label={t('measure.schedule') || 'TAKE-OFF'}>
          <RibbonButton id="btn-open-schedule"
            title={t('measure.openSchedule') || 'Open Take-Off'}
            icon={scheduleIcon}
            label={t('measure.openSchedule') || 'Take-Off'}
            disabled={noPdf()}
            active={scheduleVisible()}
            onClick={toggleSchedule} />
        </RibbonGroup>

      </div>
    </div>
  );
}
