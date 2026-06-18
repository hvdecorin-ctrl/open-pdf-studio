// "Save to OpenAEC cloud" — persists the current PDF locally, then uploads a
// copy to the user's OpenAEC cloud storage (/me/files). Mirrors the Open Calc
// Studio cloud-save flow and reuses the same accounts.rs backend.
import { getActiveDocument } from '../core/state.js';
import { isTauri, readBinaryFile } from '../core/platform.js';
import { showMessage } from '../bridge.js';
import { savePDF } from './saver.js';
import { getCachedPdfBytes } from './loader.js';
import { openaecUser, openaecSignIn, openaecUploadFile } from '../solid/stores/openaecStore.js';
import i18next from 'i18next';

function basename(p) {
  if (!p) return 'document.pdf';
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || 'document.pdf';
}

export async function saveToOpenAecCloud() {
  if (!isTauri()) {
    showMessage(i18next.t('cloudDesktopOnly', { defaultValue: 'Cloud save is only available in the desktop app.' }));
    return;
  }
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    showMessage(i18next.t('noPdfLoaded', { defaultValue: 'No PDF loaded.' }));
    return;
  }

  // Require an OpenAEC sign-in (opens the browser flow if needed).
  if (!openaecUser()) {
    await openaecSignIn();
    if (!openaecUser()) return; // cancelled or failed — error already surfaced
  }

  // Persist locally first. This also prompts a path for untitled documents and
  // refreshes the cached PDF bytes that we upload next.
  const ok = await savePDF();
  if (!ok) return;

  const path = getActiveDocument()?.filePath;
  if (!path) return;

  let bytes = getCachedPdfBytes(path);
  if (!bytes) {
    try { bytes = await readBinaryFile(path); } catch (_) { /* reported below */ }
  }
  if (!bytes) {
    showMessage(i18next.t('cloudReadFail', { defaultValue: 'Could not read the saved PDF for upload.' }));
    return;
  }

  const name = basename(path);
  try {
    await openaecUploadFile(name, bytes);
    showMessage(i18next.t('cloudSaveOk', { name, defaultValue: `Saved to the OpenAEC cloud: ${name}` }));
  } catch (e) {
    const msg = String(e?.message ?? e);
    showMessage(i18next.t('cloudSaveFail', { error: msg, defaultValue: `Cloud save failed: ${msg}` }));
  }
}
