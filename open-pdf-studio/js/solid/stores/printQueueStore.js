// Print-queue for the "Open PDF Printer" virtual printer.
//
// The printer's collection port writes every print job to
// %LOCALAPPDATA%/OpenPDFPrinter/spool/latest.pdf; the Rust side sweeps that
// into unique job_<epoch>.pdf files (virtual_printer_collect) and lists them
// (virtual_printer_jobs). This store polls the sweep while the app runs and
// pops the queue dialog whenever a NEW job arrives — so printing from any
// application lands in the in-app sort/merge dialog.

import { createSignal } from 'solid-js';
import { isTauri } from '../../core/platform.js';
import { openDialog, getDialogs } from './dialogStore.js';

const [jobs, setJobs] = createSignal([]);
const [busy, setBusy] = createSignal(false);
export { jobs as printQueueJobs, busy as printQueueBusy };

const POLL_MS = 2500;
let _timer = null;
let _knownFiles = new Set();

function _invoke(cmd, args) {
  const inv = window.__TAURI__?.core?.invoke;
  if (!inv) return Promise.reject(new Error('desktop only'));
  return inv(cmd, args);
}

/** Sweep the spool and refresh the job list. Returns the fresh jobs. */
export async function refreshPrintQueue() {
  try {
    await _invoke('virtual_printer_collect');
    const list = await _invoke('virtual_printer_jobs');
    setJobs(Array.isArray(list) ? list : []);
    return jobs();
  } catch (_) {
    return jobs();
  }
}

export async function deletePrintJob(file) {
  try { await _invoke('virtual_printer_delete_job', { file }); } catch (_) {}
  await refreshPrintQueue();
}

async function _tick() {
  const list = await refreshPrintQueue();
  const files = new Set(list.map(j => j.file));
  let hasNew = false;
  for (const f of files) {
    if (!_knownFiles.has(f)) hasNew = true;
  }
  _knownFiles = files;
  if (hasNew && !getDialogs().some(d => d.name === 'print-queue')) {
    openDialog('print-queue');
  }
}

/** Start the background watcher (call once at app start). No-ops when the
 *  virtual printer isn't installed; re-checks after the user installs it
 *  via startPrintQueueWatcher() from the preferences tab. */
export async function startPrintQueueWatcher() {
  if (!isTauri() || _timer) return;
  try {
    const installed = await _invoke('is_virtual_printer_installed');
    if (!installed) return;
  } catch (_) {
    return;
  }
  // Seed the known set WITHOUT popping the dialog for jobs that were already
  // sitting in the spool from a previous session.
  const initial = await refreshPrintQueue();
  _knownFiles = new Set(initial.map(j => j.file));
  _timer = setInterval(() => { _tick(); }, POLL_MS);
}

export function stopPrintQueueWatcher() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
