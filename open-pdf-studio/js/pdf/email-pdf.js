// "Verzenden per e-mail" — saves the current PDF, then opens the default mail
// client with it attached (via the email_pdf Rust command). The app never
// sends mail itself; it only opens a draft for the user to review and send.
import { getActiveDocument } from '../core/state.js';
import { isTauri, invoke } from '../core/platform.js';
import { showMessage } from '../bridge.js';
import { savePDF } from './saver.js';
import i18next from 'i18next';

function basename(p) {
  if (!p) return 'document.pdf';
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || 'document.pdf';
}

export async function emailCurrentPdf() {
  if (!isTauri()) {
    showMessage(i18next.t('emailDesktopOnly', { defaultValue: 'E-mailen is alleen in de desktop-app beschikbaar.' }));
    return;
  }
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    showMessage(i18next.t('noPdfLoaded', { defaultValue: 'Geen PDF geopend.' }));
    return;
  }
  // Persist first so there is a file on disk to attach (prompts for untitled docs).
  const ok = await savePDF();
  if (!ok) return;
  const path = getActiveDocument()?.filePath;
  if (!path) return;
  try {
    await invoke('email_pdf', { path, subject: basename(path) });
  } catch (e) {
    const msg = String(e?.message ?? e);
    showMessage(i18next.t('emailFailed', { error: msg, defaultValue: `E-mailen mislukt: ${msg}` }));
  }
}
