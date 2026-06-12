// Print-queue dialog for the "Open PDF Printer" virtual printer: every job
// printed to it (from ANY application, incl. this one) collects here. The
// user reorders jobs, merges a selection into one PDF (opens as a new
// untitled document) or opens/deletes individual jobs.
import { createSignal, createEffect, For, Show, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { printQueueJobs, refreshPrintQueue, deletePrintJob } from '../../stores/printQueueStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state } from '../../../core/state.js';
import { isTauri, invoke, readBinaryFile } from '../../../core/platform.js';

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' kB';
}

export default function PrintQueueDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const [order, setOrder] = createSignal([]);       // job files in merge order
  const [checked, setChecked] = createSignal(new Set());
  const [busyMsg, setBusyMsg] = createSignal('');

  const close = () => closeDialog('print-queue');

  // Keep the local order in sync with the store: new jobs append, removed
  // jobs drop out, user-made ordering survives refreshes.
  let seen = new Set();
  createEffect(() => {
    const files = printQueueJobs().map(j => j.file);
    setOrder(prev => {
      const kept = prev.filter(f => files.includes(f));
      const added = files.filter(f => !kept.includes(f));
      return [...kept, ...added];
    });
    setChecked(prev => {
      // Drop vanished jobs; auto-check only jobs we have never seen, so a
      // deliberately UNchecked job stays unchecked across refreshes.
      const next = new Set([...prev].filter(f => files.includes(f)));
      for (const f of files) if (!seen.has(f)) next.add(f);
      seen = new Set(files);
      return next;
    });
  });

  onMount(() => { refreshPrintQueue(); });

  const jobByFile = (file) => printQueueJobs().find(j => j.file === file);
  const orderedJobs = () => order().map(jobByFile).filter(Boolean);
  const checkedCount = () => orderedJobs().filter(j => checked().has(j.file)).length;

  function toggle(file) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }

  function moveJob(file, dir) {
    setOrder(prev => {
      const i = prev.indexOf(file);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  // Open a PDF (path) as a fresh UNTITLED document — same flow as
  // createDocFromTemplate (copy to temp so the spool file stays free).
  async function openAsUntitled(bytes, displayName) {
    const tempPath = await invoke('write_temp_pdf', { data: Array.from(bytes) });
    try { await invoke('allow_fs_scope', { path: tempPath }); } catch {}
    const tabsMod = await import('../../../ui/chrome/tabs.js');
    const loaderMod = await import('../../../pdf/loader.js');
    const { index } = tabsMod.createTab(tempPath);
    const doc = state.documents[index];
    if (doc) doc.isUntitled = true;
    await loaderMod.loadPDF(tempPath, index);
    if (doc) doc.fileName = displayName;
  }

  async function handleOpen(job) {
    if (!isTauri()) return;
    setBusyMsg(t('printQueue.opening') || 'Openen…');
    try {
      try { await invoke('allow_fs_scope', { path: job.path }); } catch {}
      const bytes = await readBinaryFile(job.path);
      await openAsUntitled(new Uint8Array(bytes), job.file);
      close();
    } catch (e) {
      setBusyMsg(String(e?.message ?? e));
      return;
    }
    setBusyMsg('');
  }

  async function handleMerge() {
    const targets = orderedJobs().filter(j => checked().has(j.file));
    if (targets.length === 0) return;
    setBusyMsg(t('printQueue.merging') || 'Samenvoegen…');
    try {
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      for (const job of targets) {
        try { await invoke('allow_fs_scope', { path: job.path }); } catch {}
        const bytes = await readBinaryFile(job.path);
        const src = await PDFDocument.load(new Uint8Array(bytes));
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const p of pages) out.addPage(p);
      }
      const merged = await out.save();
      await openAsUntitled(merged, t('printQueue.mergedName') || 'Samengevoegd.pdf');
      // The merge consumed the jobs — clear them from the spool.
      for (const job of targets) await deletePrintJob(job.file);
      close();
    } catch (e) {
      setBusyMsg(String(e?.message ?? e));
      return;
    }
    setBusyMsg('');
  }

  const footer = (
    <div class="print-footer-bar">
      <div class="print-footer-left">
        <Show when={busyMsg()}><span>{busyMsg()}</span></Show>
      </div>
      <div class="print-footer-right">
        <button class="pref-btn pref-btn-primary" disabled={checkedCount() === 0} onClick={handleMerge}>
          {t('printQueue.merge') || 'Samenvoegen'}{checkedCount() > 1 ? ` (${checkedCount()})` : ''}
        </button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('close')}</button>
      </div>
    </div>
  );

  return (
    <Dialog
      title={t('printQueue.title') || 'Afdrukopdrachten — Open PDF Printer'}
      dialogClass="print-queue-dialog"
      onClose={close}
      footer={footer}
    >
      <Show when={orderedJobs().length > 0} fallback={
        <div class="print-queue-empty">{t('printQueue.empty') || 'Geen afdrukopdrachten. Print vanuit een programma naar "Open PDF Printer" en de opdracht verschijnt hier.'}</div>
      }>
        <div class="print-queue-list">
          <For each={orderedJobs()}>
            {(job) => (
              <div class="print-queue-row">
                <input type="checkbox" checked={checked().has(job.file)} onChange={() => toggle(job.file)} />
                <div class="print-queue-info">
                  <div class="print-queue-name">{job.file}</div>
                  <div class="print-queue-meta">
                    {(t('printQueue.pages') || 'Bladzijden')}: {job.pages || '?'} · {fmtSize(job.size)} · {fmtTime(job.modifiedMs)}
                  </div>
                </div>
                <div class="print-queue-actions">
                  <button class="pref-btn" title={t('printQueue.moveUp') || 'Omhoog'} onClick={() => moveJob(job.file, -1)}>▲</button>
                  <button class="pref-btn" title={t('printQueue.moveDown') || 'Omlaag'} onClick={() => moveJob(job.file, 1)}>▼</button>
                  <button class="pref-btn" title={t('printQueue.open') || 'Openen'} onClick={() => handleOpen(job)}>
                    {t('printQueue.open') || 'Openen'}
                  </button>
                  <button class="pref-btn" title={tCommon('delete')} onClick={() => deletePrintJob(job.file)}>🗑</button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Dialog>
  );
}
