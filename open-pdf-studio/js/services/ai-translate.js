/**
 * AI-powered PDF page/document translation.
 * Uses the existing text-edit cover-and-replace system.
 */
import { getActiveDocument } from '../core/state.js';
import { createReplaceTextEdit } from '../tools/text-edit-tool.js';
import { execute } from '../core/undo-manager.js';
import { chatSync } from './ai-api.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';

/**
 * Translate a single page.
 * @param {number} pageNum - 1-based page number
 * @param {string} targetLang - Target language name (e.g. "Dutch", "German")
 * @param {function} onProgress - Callback(current, total) for progress updates
 * @returns {Promise<number>} Number of blocks translated
 */
export async function translatePage(pageNum, targetLang, onProgress) {
  const doc = getActiveDocument();
  if (!doc || !doc.pdfDoc) throw new Error('No document open');

  const blocks = getTextBlocks(pageNum);
  if (blocks.length === 0) throw new Error('No text found on this page');

  let translated = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (onProgress) onProgress(i + 1, blocks.length);

    // Skip very short text (punctuation, numbers only)
    if (block.text.trim().length < 3) continue;
    if (/^[\d\s.,;:!?()[\]{}<>@#$%^&*+=|\\/'"-]+$/.test(block.text.trim())) continue;

    try {
      const result = await chatSync('translate', block.text, {
        language: targetLang,
        max_tokens: Math.max(256, block.text.length * 2),
        temperature: 0.3,
      });

      const translatedText = result.content?.trim();
      if (!translatedText || translatedText === block.text) continue;

      const editResult = createReplaceTextEdit(pageNum, block.text, translatedText, block.span);
      if (editResult) {
        execute({ type: 'addTextEdit', textEdit: editResult.editRecord });
        translated++;
      }
    } catch (err) {
      console.warn(`[AI Translate] Failed to translate block ${i + 1}:`, err.message);
    }
  }

  // Redraw
  if (doc.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();

  return translated;
}

/**
 * Translate all pages in the document.
 * @param {string} targetLang - Target language name
 * @param {function} onProgress - Callback(currentPage, totalPages, blockCurrent, blockTotal)
 * @returns {Promise<number>} Total blocks translated
 */
export async function translateDocument(targetLang, onProgress) {
  const doc = getActiveDocument();
  if (!doc || !doc.pdfDoc) throw new Error('No document open');

  const totalPages = doc.pdfDoc.numPages;
  let totalTranslated = 0;

  for (let page = 1; page <= totalPages; page++) {
    // Ensure text layer is rendered for this page
    await ensureTextLayer(page);

    const blocks = getTextBlocks(page);
    if (blocks.length === 0) continue;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (onProgress) onProgress(page, totalPages, i + 1, blocks.length);

      if (block.text.trim().length < 3) continue;
      if (/^[\d\s.,;:!?()[\]{}<>@#$%^&*+=|\\/'"-]+$/.test(block.text.trim())) continue;

      try {
        const result = await chatSync('translate', block.text, {
          language: targetLang,
          max_tokens: Math.max(256, block.text.length * 2),
          temperature: 0.3,
        });

        const translatedText = result.content?.trim();
        if (!translatedText || translatedText === block.text) continue;

        const editResult = createReplaceTextEdit(page, block.text, translatedText, block.span);
        if (editResult) {
          doc.textEdits.push(editResult.editRecord);
          totalTranslated++;
        }
      } catch (err) {
        console.warn(`[AI Translate] Page ${page}, block ${i + 1}:`, err.message);
      }
    }
  }

  if (doc.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();

  return totalTranslated;
}

/**
 * Undo all AI translations on a page (remove text edits that were AI-generated).
 * @param {number} pageNum - Page number, or 0 for all pages
 */
export function undoTranslations(pageNum) {
  const doc = getActiveDocument();
  if (!doc || !doc.textEdits) return;

  const editsToRemove = pageNum > 0
    ? doc.textEdits.filter(e => e.page === pageNum)
    : [...doc.textEdits];

  for (const edit of editsToRemove) {
    const idx = doc.textEdits.indexOf(edit);
    execute({ type: 'removeTextEdit', textEdit: edit, index: idx >= 0 ? idx : 0 });
  }

  if (doc.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// ── Internal helpers ──

function getTextBlocks(pageNum) {
  // Find the text layer for this page
  const layers = document.querySelectorAll('.textLayer');
  let targetLayer = null;

  for (const layer of layers) {
    const pageAttr = layer.getAttribute('data-page') || layer.parentElement?.getAttribute('data-page-number');
    if (parseInt(pageAttr) === pageNum) {
      targetLayer = layer;
      break;
    }
  }

  // Fallback: single-page mode — just use the first text layer
  if (!targetLayer && layers.length > 0) {
    targetLayer = layers[0];
  }

  if (!targetLayer) return [];

  const spans = Array.from(targetLayer.querySelectorAll('span[data-pdf-transform]'));
  if (spans.length === 0) return [];

  // Group adjacent spans into lines by Y coordinate
  const items = spans.map(span => {
    let transform;
    try { transform = JSON.parse(span.dataset.pdfTransform); } catch { return null; }
    if (!transform) return null;
    const fontSize = Math.sqrt(transform[2] ** 2 + transform[3] ** 2) || 12;
    return { span, pdfY: transform[5], pdfX: transform[4], fontSize, text: span.textContent || '' };
  }).filter(Boolean);

  // Sort by Y descending (top of page first), then X ascending
  items.sort((a, b) => b.pdfY - a.pdfY || a.pdfX - b.pdfX);

  // Group into lines (same Y within tolerance)
  const lines = [];
  let currentLine = [items[0]];

  for (let i = 1; i < items.length; i++) {
    const prev = currentLine[0];
    const curr = items[i];
    if (Math.abs(curr.pdfY - prev.pdfY) < prev.fontSize * 0.3) {
      currentLine.push(curr);
    } else {
      lines.push(currentLine);
      currentLine = [curr];
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  // Build blocks — each line becomes a translateable block using its first span
  return lines.map(lineSpans => ({
    text: lineSpans.map(s => s.text).join(' '),
    span: lineSpans[0].span,
    fontSize: lineSpans[0].fontSize,
  })).filter(b => b.text.trim().length > 0);
}

async function ensureTextLayer(pageNum) {
  // In continuous mode, text layers should already exist
  // In single-page mode, we'd need to navigate to the page
  // For now, just wait a tick for rendering
  await new Promise(r => setTimeout(r, 100));
}
