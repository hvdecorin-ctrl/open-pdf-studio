// Build polygon path without stroking (for fill/hatch/stroke to be applied by caller)
export function buildPolygonPath(ctx, x, y, width, height, sides = 6) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
    const px = cx + rx * Math.cos(angle);
    const py = cy + ry * Math.sin(angle);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

// Draw polygon shape (stroke only - legacy convenience wrapper)
export function drawPolygonShape(ctx, x, y, width, height, sides = 6) {
  buildPolygonPath(ctx, x, y, width, height, sides);
  ctx.stroke();
}

// Build cloud path without stroking (for fill/hatch/stroke to be applied by caller)
export function buildCloudPath(ctx, x, y, width, height) {
  const bumpRadius = Math.min(width, height) / 8;
  const numBumpsH = Math.max(3, Math.floor(width / (bumpRadius * 1.5)));
  const numBumpsV = Math.max(2, Math.floor(height / (bumpRadius * 1.5)));

  ctx.beginPath();

  // Top edge (left to right)
  const topSpacing = width / numBumpsH;
  for (let i = 0; i < numBumpsH; i++) {
    const bx = x + topSpacing * (i + 0.5);
    ctx.arc(bx, y, bumpRadius, Math.PI, 0, false);
  }

  // Right edge (top to bottom)
  const rightSpacing = height / numBumpsV;
  for (let i = 0; i < numBumpsV; i++) {
    const by = y + rightSpacing * (i + 0.5);
    ctx.arc(x + width, by, bumpRadius, -Math.PI / 2, Math.PI / 2, false);
  }

  // Bottom edge (right to left)
  for (let i = numBumpsH - 1; i >= 0; i--) {
    const bx = x + topSpacing * (i + 0.5);
    ctx.arc(bx, y + height, bumpRadius, 0, Math.PI, false);
  }

  // Left edge (bottom to top)
  for (let i = numBumpsV - 1; i >= 0; i--) {
    const by = y + rightSpacing * (i + 0.5);
    ctx.arc(x, by, bumpRadius, Math.PI / 2, -Math.PI / 2, false);
  }

  ctx.closePath();
}

// Draw cloud shape (stroke only - legacy convenience wrapper)
export function drawCloudShape(ctx, x, y, width, height) {
  buildCloudPath(ctx, x, y, width, height);
  ctx.stroke();
}

// Build cloud path along arbitrary points (closed polygon with scallop edges)
export function buildCloudPolylinePath(ctx, points, closed = true) {
  if (!points || points.length < 2) return;
  const TARGET_BUMP = 12; // target bump radius in user units

  ctx.beginPath();
  const len = closed ? points.length : points.length - 1;
  for (let i = 0; i < len; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const edgeLen = Math.sqrt(dx * dx + dy * dy);
    if (edgeLen < 1) continue;

    const numBumps = Math.max(1, Math.round(edgeLen / (TARGET_BUMP * 1.5)));
    const bumpRadius = edgeLen / numBumps / 2;
    const angle = Math.atan2(dy, dx);
    // Normal direction (perpendicular, pointing outward for CW winding)
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);

    for (let j = 0; j < numBumps; j++) {
      const t = (j + 0.5) / numBumps;
      const cx = p1.x + dx * t;
      const cy = p1.y + dy * t;
      // Arc center offset outward
      const arcCx = cx + nx * 0;
      const arcCy = cy + ny * 0;
      // Start and end angles for the arc (perpendicular to edge, sweeping outward)
      const startAngle = angle + Math.PI;
      const endAngle = angle;
      ctx.arc(arcCx, arcCy, bumpRadius, startAngle, endAngle, false);
    }
  }
  if (closed) ctx.closePath();
}

// Compute the minimum height needed for textbox content (same word-wrap logic as drawTextboxContent)
// Line-spacing default 1.2 matches CSS "normal" line-height for most fonts
// AND matches what reference desktop PDF editors use when /DS has no explicit line-height.
// Was 1.0 (too tight — two lines of text in a 36pt box visibly stuck together
// instead of showing the gap reference viewers render).
const DEFAULT_LINE_SPACING = 1.2;

export function computeTextboxContentHeight(annotation) {
  if (!annotation.text) return annotation.height || 50;

  const width = annotation.width || 150;
  const fontSize = annotation.fontSize || 14;
  const lineSpacing = annotation.lineSpacing || DEFAULT_LINE_SPACING;
  const lineHeight = fontSize * lineSpacing;
  // Match drawTextboxContent: padding == borderWidth (no minimum).
  const padding = annotation.lineWidth ?? 0;
  const maxWidth = width - padding * 2;

  // Match drawTextboxContent's font-family fallback chain so measureText
  // sees the same metrics the actual render will use.
  const rawFontFamily = annotation.fontFamily || 'Arial';
  const _cssQuote = s => `"${s.replace(/"/g, '\\"')}"`;
  const _expanded = rawFontFamily.replace(/([a-z])([A-Z])/g, '$1 $2');
  const _chain = [];
  if (_expanded !== rawFontFamily) _chain.push(_cssQuote(_expanded));
  _chain.push(/[\s"',]/.test(rawFontFamily) ? _cssQuote(rawFontFamily) : rawFontFamily);
  _chain.push('sans-serif');
  const fontFamily = _chain.join(', ');
  const fontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
  const font = `${fontStyle}${fontSize}px ${fontFamily}`;

  // Use offscreen canvas for text measurement
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;

  const paragraphs = annotation.text.split('\n');
  let totalLines = 0;

  for (const para of paragraphs) {
    if (!para) {
      // Empty line counts as one line
      totalLines++;
      continue;
    }
    const words = para.split(' ');
    let line = '';
    let paraLines = 0;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      if (ctx.measureText(testLine).width > maxWidth && i > 0) {
        paraLines++;
        line = words[i] + ' ';
      } else {
        line = testLine;
      }
    }
    if (line.trim()) paraLines++;
    totalLines += paraLines;
  }

  return padding * 2 + totalLines * lineHeight;
}

// Compute the wrapped text layout for a textbox/callout, mirroring
// drawTextboxContent's wrapping (same font fallback chain + canvas measureText,
// same padding/lineHeight/ascent). Used by the PDF saver to build a FreeText
// /AP appearance stream whose line breaks + vertical placement match what OPDS
// draws on screen — so other viewers show the same thing (no overflow).
// Returns { lines:[{text,width}], fontSize, lineHeight, padding, ascent, maxWidth }.
export function layoutTextboxForExport(annotation) {
  const text = annotation.text || '';
  const width = annotation.width || 150;
  const fontSize = annotation.fontSize || 14;
  const lineSpacing = annotation.lineSpacing || DEFAULT_LINE_SPACING;
  const lineHeight = fontSize * lineSpacing;
  const padding = annotation.lineWidth ?? 0;
  const maxWidth = Math.max(1, width - padding * 2);

  const rawFontFamily = annotation.fontFamily || 'Arial';
  const cssQuote = s => `"${s.replace(/"/g, '\\"')}"`;
  const expanded = rawFontFamily.replace(/([a-z])([A-Z])/g, '$1 $2');
  const chain = [];
  if (expanded !== rawFontFamily) chain.push(cssQuote(expanded));
  chain.push(/[\s"',]/.test(rawFontFamily) ? cssQuote(rawFontFamily) : rawFontFamily);
  chain.push('sans-serif');
  const fontFamily = chain.join(', ');
  const fontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
  const sample = ctx.measureText('Mg');
  const ascent = sample.fontBoundingBoxAscent || sample.actualBoundingBoxAscent || (fontSize * 0.8);

  const lines = [];
  for (const para of text.split('\n')) {
    if (para === '') { lines.push({ text: '', width: 0 }); continue; }
    const words = para.split(' ');
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const candidate = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push({ text: line, width: ctx.measureText(line).width });
        line = words[i];
      } else {
        line = candidate;
      }
    }
    if (line !== '') lines.push({ text: line, width: ctx.measureText(line).width });
  }
  return { lines, fontSize, lineHeight, padding, ascent, maxWidth };
}

// Draw textbox content with word wrap
export function drawTextboxContent(ctx, annotation, padding) {
  if (!annotation.text) return;

  const width = annotation.width || 150;
  const height = annotation.height || 50;
  const fontSize = annotation.fontSize || 14;
  const lineSpacing = annotation.lineSpacing || DEFAULT_LINE_SPACING;
  const lineHeight = fontSize * lineSpacing;
  // Padding ≈ borderWidth (no extra). Reference desktop editors and most PDF viewers do
  // not add internal padding beyond the border line itself, so the text
  // content area = width − 2*borderWidth. The previous +1 reduced the
  // effective text width by 4px and made "CONSTRUCTIE OVERZICHT" wrap to
  // two lines in textboxes that reference viewers fit on one line.
  // Padding == borderWidth, no minimum. Reference viewers treat BS /W 0 as
  // "text fills the rect to its edges". The previous Math.max(_, 1)
  // forced a 1pt margin even when lineWidth==0 → text "CONSTRUCTIE
  // OVERZICHT" (275.61pt wide in Segoe UI Bold 22pt) was just barely
  // wider than the resulting 273.88pt content area → wrapped to 2 lines.
  // Real measurement (logged via [textbox-debug]): box=275.88pt,
  // text=275.61pt → fits with padding=0, doesn't with padding=1.
  if (padding === undefined) padding = annotation.lineWidth ?? 0;

  // Build font string with style options.
  // CSS font shorthand requires multi-word family names ("Segoe UI") to be
  // quoted — unquoted, Canvas parses "Segoe" + invalid token "UI" and falls
  // back to the next family (often the browser default = Arial). Concrete
  // victim: externally-authored annotations carry DS=font-family:Segoe UI;..., we
  // extract "Segoe UI" correctly, but unquoted in ctx.font it silently
  // becomes Arial → wider glyphs → wraps to 2 lines. Always quote.
  const rawFontFamily = annotation.fontFamily || 'Arial';
  // Build a CSS font-family fallback chain:
  //   1. camelCase-expanded variant ("SegoeUI" → "Segoe UI") — some editors
  //      sometimes emits the system font name without spaces; Windows
  //      registers Segoe UI WITH the space, so the unspaced form silently
  //      falls back to serif. Expanding first restores the match.
  //   2. original name (quoted if multi-word) — preserves intent if the
  //      author actually used the unspaced form on purpose.
  //   3. sans-serif — last-resort fallback (Arial on Windows).
  const cssQuote = s => `"${s.replace(/"/g, '\\"')}"`;
  const expanded = rawFontFamily.replace(/([a-z])([A-Z])/g, '$1 $2');
  const fallbackChain = [];
  if (expanded !== rawFontFamily) fallbackChain.push(cssQuote(expanded));
  fallbackChain.push(/[\s"',]/.test(rawFontFamily) ? cssQuote(rawFontFamily) : rawFontFamily);
  fallbackChain.push('sans-serif');
  const fontFamily = fallbackChain.join(', ');
  const fontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
  ctx.fillStyle = annotation.textColor || annotation.color || '#000000';
  ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
  // Use alphabetic baseline (PDF/CSS default). Y refers to the text BASELINE,
  // with ascent above and descent below. PDF spec FreeText appearance
  // streams position the first baseline at `lineHeight` below the box top
  // (one full line worth of space, leaving room for ascent + half-leading).
  // textBaseline='top' (former code) put the em-box top AT the box top,
  // giving only ~font's intrinsic ascent-gap (≈1-2pt) of visible margin —
  // too tight vs reference viewers which show ~lineHeight worth of gap.
  ctx.textBaseline = 'alphabetic';

  // Get text alignment
  const textAlign = annotation.textAlign || 'left';
  const maxWidth = width - padding * 2;

  // First-line baseline position. With textBaseline='alphabetic', y refers
  // to the baseline. To match CSS textarea rendering (which the edit-mode
  // overlay uses), we need:
  //
  //   baseline_y = box_top + padding + halfLeading + ascent
  //
  // Where ascent is the font's typographic ascent (visible top of capital
  // letters above baseline). Canvas's TextMetrics exposes this via
  // `actualBoundingBoxAscent` (per-string) and `fontBoundingBoxAscent`
  // (font-level — preferred but not on all browsers). Sample 'Mg' to
  // measure both the tall ascent (M) and a descender (g) so we get the
  // full font box, then fall back to 0.8 × fontSize if metrics unavailable.
  const halfLeading = (lineHeight - fontSize) / 2;
  const _sample = ctx.measureText('Mg');
  const ascent = _sample.fontBoundingBoxAscent
              || _sample.actualBoundingBoxAscent
              || (fontSize * 0.8);
  const paragraphs = annotation.text.split('\n');
  let y = annotation.y + padding + halfLeading + ascent;

  for (let p = 0; p < paragraphs.length; p++) {
    if (y >= annotation.y + height) break;

    // Empty line: just advance y
    if (!paragraphs[p]) {
      y += lineHeight;
      continue;
    }

    const words = paragraphs[p].split(' ');
    let line = '';

    for (let i = 0; i < words.length; i++) {
      // Measure WITHOUT trailing space — a trailing space contributes ~3-4px
      // to ctx.measureText().width but is never rendered (canvas doesn't draw
      // trailing whitespace beyond the last glyph). Including it in the
      // wrap-trigger comparison made lines wrap one word too early.
      const candidate = line + words[i];
      const metrics = ctx.measureText(candidate);
      if (metrics.width > maxWidth && i > 0) {
        // Calculate x position based on alignment
        let textX = annotation.x + padding;
        const lineWidth = ctx.measureText(line.trim()).width;
        if (textAlign === 'center') {
          textX = annotation.x + padding + (maxWidth - lineWidth) / 2;
        } else if (textAlign === 'right') {
          textX = annotation.x + width - padding - lineWidth;
        }

        ctx.fillText(line.trim(), textX, y);

        // Draw underline if enabled
        if (annotation.fontUnderline) {
          ctx.beginPath();
          ctx.moveTo(textX, y + fontSize + 1);
          ctx.lineTo(textX + lineWidth, y + fontSize + 1);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw strikethrough if enabled
        if (annotation.fontStrikethrough) {
          ctx.beginPath();
          ctx.moveTo(textX, y + fontSize * 0.6);
          ctx.lineTo(textX + lineWidth, y + fontSize * 0.6);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        line = words[i] + ' ';
        y += lineHeight;
        if (y >= annotation.y + height) break;
      } else {
        // Trailing space is the inter-word separator for the next concat;
        // it intentionally lives in `line` but is excluded from the wrap-
        // measurement (see candidate above).
        line = candidate + ' ';
      }
    }
    if (y < annotation.y + height && line.trim()) {
      // Calculate x position based on alignment
      let textX = annotation.x + padding;
      const lineWidth = ctx.measureText(line.trim()).width;
      if (textAlign === 'center') {
        textX = annotation.x + padding + (maxWidth - lineWidth) / 2;
      } else if (textAlign === 'right') {
        textX = annotation.x + width - padding - lineWidth;
      }

      ctx.fillText(line.trim(), textX, y);

      // Draw underline if enabled
      if (annotation.fontUnderline) {
        ctx.beginPath();
        ctx.moveTo(textX, y + fontSize + 1);
        ctx.lineTo(textX + lineWidth, y + fontSize + 1);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw strikethrough if enabled
      if (annotation.fontStrikethrough) {
        ctx.beginPath();
        ctx.moveTo(textX, y + fontSize * 0.6);
        ctx.lineTo(textX + lineWidth, y + fontSize * 0.6);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      y += lineHeight;
    }
  }
  ctx.textBaseline = 'alphabetic'; // Reset
}
