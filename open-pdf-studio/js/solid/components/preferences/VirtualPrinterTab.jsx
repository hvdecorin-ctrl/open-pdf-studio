import { createSignal, onMount } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { showMessage } from '../../stores/dialogStore.js';

export default function VirtualPrinterTab() {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const [status, setStatus] = createSignal(tCommon('checking'));
  const [statusColor, setStatusColor] = createSignal('#666');
  const [showInstall, setShowInstall] = createSignal(false);
  const [showRemove, setShowRemove] = createSignal(false);
  const [showReconfigure, setShowReconfigure] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    checkStatus();
  });

  async function checkStatus() {
    setShowInstall(false);
    setShowRemove(false);
    setShowReconfigure(false);
    try {
      const { invoke } = await import('../../../core/platform.js');
      const installed = await invoke('is_virtual_printer_installed');
      if (installed) {
        // Installed — but is it in SILENT CATCH mode, or the legacy
        // save-dialog (PORTPROMPT) port? Offer to reconfigure if the latter.
        let catchMode = false;
        try { catchMode = await invoke('virtual_printer_catch_enabled'); } catch {}
        if (catchMode) {
          setStatus(t('virtualPrinter.catchActive') || 'Geïnstalleerd — PDF-opvang actief');
          setStatusColor('#2e7d32');
        } else {
          setStatus(t('virtualPrinter.saveDialogMode') || 'Geïnstalleerd — toont nog een opslaan-venster');
          setStatusColor('#b26a00');
          setShowReconfigure(true);
        }
        setShowRemove(true);
      } else {
        setStatus(tCommon('notInstalled'));
        setStatusColor('#666');
        setShowInstall(true);
      }
    } catch {
      setStatus(tCommon('unableToDetect'));
      setStatusColor('#888');
      setShowInstall(true);
    }
  }

  async function handleInstall() {
    setStatus(t('virtualPrinter.installing'));
    setBusy(true);
    try {
      const { invoke } = await import('../../../core/platform.js');
      // Collection port: prints land in the spool dir so the in-app print
      // queue (sort/merge dialog) picks them up — from ANY application.
      await invoke('install_virtual_printer', { useCollection: true });
      // Start watching the spool right away (no restart needed).
      import('../../stores/printQueueStore.js')
        .then(m => m.startPrintQueueWatcher())
        .catch(() => {});
      // Re-read state so the status reflects "catch active" (and hides the
      // reconfigure button).
      await checkStatus();
    } catch (err) {
      setStatus(t('virtualPrinter.installationFailed'));
      setStatusColor('#c62828');
      showMessage(t('virtualPrinter.failedToInstall') + '\n' + (err.message || err));
    }
    setBusy(false);
  }

  async function handleRemove() {
    setStatus(t('virtualPrinter.removing'));
    setBusy(true);
    try {
      const { invoke } = await import('../../../core/platform.js');
      await invoke('remove_virtual_printer');
      setStatus(tCommon('notInstalled'));
      setStatusColor('#666');
      setShowRemove(false);
      setShowInstall(true);
    } catch (err) {
      setStatus(t('virtualPrinter.removalFailed'));
      setStatusColor('#c62828');
      showMessage(t('virtualPrinter.failedToRemove') + '\n' + (err.message || err));
    }
    setBusy(false);
  }

  return (
    <fieldset class="pref-fieldset">
      <legend>{t('virtualPrinter.title')}</legend>
      <p style="font-size:11px;color:var(--theme-text-secondary, #555);margin-bottom:12px;line-height:1.4;">
        {t('virtualPrinter.description')}
      </p>
      <div class="pref-row">
        <label>{t('virtualPrinter.status')}</label>
        <span style={{ 'font-size': '11px', color: statusColor() }}>{status()}</span>
      </div>
      <div class="pref-row" style="margin-top:12px;">
        {showInstall() && (
          <button type="button" class="pref-btn pref-btn-primary" style="width:100%;" onClick={handleInstall} disabled={busy()}>
            {t('virtualPrinter.installButton')}
          </button>
        )}
        {showReconfigure() && (
          <button type="button" class="pref-btn pref-btn-primary" style="width:100%;" onClick={handleInstall} disabled={busy()}>
            {t('virtualPrinter.enableCatch') || 'PDF-opvang inschakelen (geen opslaan-venster)'}
          </button>
        )}
        {showRemove() && (
          <button type="button" class="pref-btn pref-btn-secondary" style="width:100%;margin-top:6px;" onClick={handleRemove} disabled={busy()}>
            {t('virtualPrinter.removeButton')}
          </button>
        )}
      </div>
      <p style="font-size:10px;color:var(--theme-text-secondary, #888);margin-top:12px;line-height:1.4;">
        {t('virtualPrinter.installNote')}
      </p>
    </fieldset>
  );
}
