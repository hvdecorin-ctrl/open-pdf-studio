import { createSignal, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function CalibrationDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const [distance, setDistance] = createSignal(1);
  const [unit, setUnit] = createSignal('px');
  const [pixels, setPixels] = createSignal(72);

  onMount(() => {
    const ms = state.preferences.measureScale;
    if (ms) {
      setUnit(ms.unit || 'px');
    }
  });

  const cancel = () => { closeDialog('calibration'); };

  function handleApply() {
    const d = parseFloat(distance());
    const p = parseFloat(pixels());
    if (d > 0 && p > 0) {
      state.preferences.measureScale = { pixelsPerUnit: p / d, unit: unit() };
      savePreferences();
    }
    closeDialog('calibration');
  }

  function handleReset() {
    delete state.preferences.measureScale;
    savePreferences();
    closeDialog('calibration');
  }

  const footer = (
    <div style={{ display: 'flex', 'justify-content': 'flex-end', gap: '8px' }}>
      <button
        style={{
          padding: '4px 12px',
          border: '1px solid #ccc',
          background: '#fff',
          cursor: 'pointer',
          'font-size': '12px',
          'border-radius': '0'
        }}
        onClick={handleReset}
      >
        {tCommon('reset')}
      </button>
      <button
        style={{
          padding: '4px 12px',
          border: '1px solid #0078d4',
          background: '#0078d4',
          color: '#fff',
          cursor: 'pointer',
          'font-size': '12px',
          'border-radius': '0'
        }}
        onClick={handleApply}
      >
        {tCommon('apply')}
      </button>
    </div>
  );

  return (
    <Dialog
      title={t('calibration.title')}
      overlayClass="calibration-overlay"
      dialogClass="calibration-dialog"
      onClose={cancel}
      footer={footer}
    >
      <p style={{ 'font-size': '12px', color: '#666', margin: '0 0 12px 0' }}>
        {t('calibration.helpText')}
      </p>
      <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', 'margin-bottom': '12px' }}>
        <label style={{ 'font-size': '13px' }}>{t('calibration.knownDistance')}</label>
        <input
          type="number"
          style={{ width: '80px', padding: '4px', border: '1px solid #ccc', 'border-radius': '0' }}
          min="0.01"
          step="0.01"
          value={distance()}
          onInput={(e) => setDistance(e.target.value)}
        />
        <select
          style={{ padding: '4px', border: '1px solid #ccc', 'border-radius': '0' }}
          value={unit()}
          onChange={(e) => setUnit(e.target.value)}
        >
          <option value="mm">{tCommon('mm')}</option>
          <option value="cm">{tCommon('cm')}</option>
          <option value="in">{tCommon('in')}</option>
          <option value="pt">{tCommon('pt')}</option>
          <option value="px">{tCommon('px')}</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', 'margin-bottom': '12px' }}>
        <label style={{ 'font-size': '13px' }}>{t('calibration.measuredPixels')}</label>
        <input
          type="number"
          style={{ width: '80px', padding: '4px', border: '1px solid #ccc', 'border-radius': '0' }}
          min="1"
          value={pixels()}
          onInput={(e) => setPixels(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
