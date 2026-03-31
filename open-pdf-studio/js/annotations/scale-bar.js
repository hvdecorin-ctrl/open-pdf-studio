import { createAnnotation } from './factory.js';
import { state, getActiveDocument } from '../core/state.js';

/**
 * Create a scale bar annotation at the given position.
 * Uses the current document scale or defaults.
 */
export function createScaleBar(x, y) {
  const doc = getActiveDocument();
  const ms = doc?.measureScale;
  const unit = ms?.unit || 'mm';

  // Default: 5000mm (5m) scale bar with 5 divisions (each 1000mm = 1m)
  const totalUnits = 5000;
  const divisions = 5;

  let pixelsPerUnit = ms?.pixelsPerUnit || 0;
  let barWidth;

  if (pixelsPerUnit > 0) {
    barWidth = totalUnits * pixelsPerUnit;
  } else {
    // No scale calibrated yet — use a visual width and derive pixelsPerUnit
    barWidth = 300;
    pixelsPerUnit = barWidth / totalUnits;
  }

  const barHeight = 14;

  return createAnnotation({
    type: 'scaleBar',
    page: doc?.currentPage || 1,
    x, y,
    width: barWidth,
    height: barHeight,
    rotation: 0,
    pixelsPerUnit,
    unit,
    divisions,
    totalUnits,
    regionX: 0,
    regionY: 0,
    regionWidth: 0,
    regionHeight: 0,
    color: '#000000',
    lineWidth: 1,
    opacity: 1,
  });
}

/**
 * Get the effective scale for a specific point on a specific page.
 * Logic:
 *  - If there is exactly 1 scaleBar across all pages → use its scale everywhere
 *  - If there are scaleBars on different pages → use the one on the same page
 *  - If there are multiple on the same page → check if point is within a region
 *  - Fallback to doc.measureScale
 */
export function getScaleForPoint(pageNum, x, y) {
  const doc = getActiveDocument();
  if (!doc) return doc?.measureScale || null;

  // Collect all scaleBar annotations
  const scaleBars = (doc.annotations || []).filter(a => a.type === 'scaleBar');

  if (scaleBars.length === 0) {
    return doc.measureScale || null;
  }

  if (scaleBars.length === 1) {
    // Single scale bar → applies to entire document
    const sb = scaleBars[0];
    return { pixelsPerUnit: sb.pixelsPerUnit, unit: sb.unit, method: 'scaleBar' };
  }

  // Multiple scale bars — check same page first
  const samePage = scaleBars.filter(sb => sb.page === pageNum);

  if (samePage.length === 0) {
    // No scale bar on this page — check if any other page has one
    // Use the first one found (or doc.measureScale)
    return doc.measureScale || { pixelsPerUnit: scaleBars[0].pixelsPerUnit, unit: scaleBars[0].unit, method: 'scaleBar' };
  }

  if (samePage.length === 1) {
    // One scale bar on this page → applies to entire page
    const sb = samePage[0];
    return { pixelsPerUnit: sb.pixelsPerUnit, unit: sb.unit, method: 'scaleBar' };
  }

  // Multiple scale bars on same page → check regions
  for (const sb of samePage) {
    if (sb.regionWidth > 0 && sb.regionHeight > 0) {
      if (x >= sb.regionX && x <= sb.regionX + sb.regionWidth &&
          y >= sb.regionY && y <= sb.regionY + sb.regionHeight) {
        return { pixelsPerUnit: sb.pixelsPerUnit, unit: sb.unit, method: 'scaleBar' };
      }
    }
  }

  // No region match — use the first one on this page
  return { pixelsPerUnit: samePage[0].pixelsPerUnit, unit: samePage[0].unit, method: 'scaleBar' };
}

/**
 * Try to detect the scale from the PDF's text content (title block).
 * Looks for patterns like "1:100", "SCHAAL 1:50", "SCALE: 1:200", "M 1:500".
 * Returns { ratio: number, scaleText: string } or null if not found.
 */
export async function detectScaleFromPdf(pageNum) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;

  const page = await doc.pdfDoc.getPage(pageNum || doc.currentPage);
  const textContent = await page.getTextContent();

  // Patterns ordered from most specific (labelled) to least specific (bare 1:N).
  // The labelled pattern avoids false positives from dimensions like "2:3".
  const patterns = [
    /(?:schaal|scale|maatstaf|maßstab|ma(?:ss|ß)stab|échelle|escala|scala|m)\s*[:=.]?\s*1\s*[:/]\s*(\d+)/i,
    /\b1\s*[:/]\s*(\d+)\b/i,
  ];

  // First pass: check the concatenated text of all items
  const allText = textContent.items.map(item => item.str).join(' ');

  for (const pattern of patterns) {
    const match = allText.match(pattern);
    if (match) {
      const ratio = parseInt(match[1], 10);
      if (ratio > 0 && ratio <= 10000) {
        return { ratio, scaleText: match[0].trim() };
      }
    }
  }

  // Second pass: check individual text items for better accuracy
  // (sometimes the scale sits in a single text element in the title block)
  for (const item of textContent.items) {
    const str = item.str.trim();
    if (!str) continue;
    for (const pattern of patterns) {
      const match = str.match(pattern);
      if (match) {
        const ratio = parseInt(match[1], 10);
        if (ratio > 0 && ratio <= 10000) {
          return { ratio, scaleText: match[0].trim() };
        }
      }
    }
  }

  return null;
}

/**
 * Sync the document-level measureScale from a scaleBar annotation.
 * Called after placing or modifying a scaleBar so that doc.measureScale
 * stays in sync and legacy code paths that read doc.measureScale still work.
 */
export function syncDocScale(scaleBar) {
  const doc = getActiveDocument();
  if (!doc || !scaleBar) return;
  if (!scaleBar.pixelsPerUnit || scaleBar.pixelsPerUnit <= 0) return;

  doc.measureScale = {
    pixelsPerUnit: scaleBar.pixelsPerUnit,
    unit: scaleBar.unit || 'mm',
    method: 'scaleBar',
    scaleRatio: 0,
  };
}
