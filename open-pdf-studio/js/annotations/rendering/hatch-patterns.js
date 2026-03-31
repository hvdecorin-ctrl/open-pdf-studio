export function applyHatchFill(ctx, annotation) {
  const pattern = annotation.hatchPattern;
  if (!pattern || pattern === 'none') return;

  const hatchColor = annotation.hatchColor || annotation.strokeColor || '#000000';
  const hatchScale = (annotation.hatchScale != null ? annotation.hatchScale : 100) / 100;
  const hatchAngle = annotation.hatchAngle || 0;
  const spacing = 10 * hatchScale;

  const bx = annotation.x || 0;
  const by = annotation.y || 0;
  const bw = annotation.width || 0;
  const bh = annotation.height || 0;
  const cx = bx + bw / 2;
  const cy = by + bh / 2;

  // Expand bounds to handle rotation without gaps
  const expandedW = bw * 1.5;
  const expandedH = bh * 1.5;
  const left = cx - expandedW / 2;
  const top = cy - expandedH / 2;
  const right = cx + expandedW / 2;
  const bottom = cy + expandedH / 2;

  ctx.save();
  ctx.clip();

  ctx.strokeStyle = hatchColor;
  ctx.fillStyle = hatchColor;
  ctx.lineWidth = 1;

  if (hatchAngle !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(hatchAngle * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  switch (pattern) {
    case 'diagonal-left':
      drawDiagonalLeft(ctx, left, top, right, bottom, spacing);
      break;
    case 'diagonal-right':
      drawDiagonalRight(ctx, left, top, right, bottom, spacing);
      break;
    case 'crosshatch':
      drawDiagonalLeft(ctx, left, top, right, bottom, spacing);
      drawDiagonalRight(ctx, left, top, right, bottom, spacing);
      break;
    case 'horizontal':
      drawHorizontal(ctx, left, top, right, bottom, spacing);
      break;
    case 'vertical':
      drawVertical(ctx, left, top, right, bottom, spacing);
      break;
    case 'dots':
      drawDots(ctx, left, top, right, bottom, spacing);
      break;
    case 'grid':
      drawHorizontal(ctx, left, top, right, bottom, spacing);
      drawVertical(ctx, left, top, right, bottom, spacing);
      break;
  }

  ctx.restore();
}

function drawDiagonalLeft(ctx, left, top, right, bottom, spacing) {
  const height = bottom - top;
  ctx.beginPath();
  for (let d = -height; d <= right - left; d += spacing) {
    ctx.moveTo(left + d, top);
    ctx.lineTo(left + d + height, bottom);
  }
  ctx.stroke();
}

function drawDiagonalRight(ctx, left, top, right, bottom, spacing) {
  const width = right - left;
  const height = bottom - top;
  ctx.beginPath();
  for (let d = 0; d <= width + height; d += spacing) {
    ctx.moveTo(right - d + height, bottom);
    ctx.lineTo(right - d, top);
  }
  ctx.stroke();
}

function drawHorizontal(ctx, left, top, right, bottom, spacing) {
  ctx.beginPath();
  for (let y = top; y <= bottom; y += spacing) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
}

function drawVertical(ctx, left, top, right, bottom, spacing) {
  ctx.beginPath();
  for (let x = left; x <= right; x += spacing) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  ctx.stroke();
}

// Apply hatch fill for polygon-based annotations (measureArea) using point arrays
export function applyHatchFillPolygon(ctx, points, holes, hatchPattern, hatchColor, hatchScale, hatchAngle) {
  if (!hatchPattern || hatchPattern === 'none' || !points || points.length < 3) return;

  const color = hatchColor || '#ff0000';
  const scale = (hatchScale != null ? hatchScale : 100) / 100;
  const angle = hatchAngle || 0;
  const spacing = 10 * scale;

  // Calculate bounding box from points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const bw = maxX - minX;
  const bh = maxY - minY;
  // Expand bounds generously for diagonal line coverage
  const diag = Math.sqrt(bw * bw + bh * bh);
  const pad = Math.max(diag, bw, bh) * 0.6;
  const left = minX - pad;
  const top = minY - pad;
  const right = maxX + pad;
  const bottom = maxY + pad;

  ctx.save();

  // Build clip path from polygon + holes (evenodd)
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  if (holes && holes.length > 0) {
    for (const hole of holes) {
      if (hole && hole.length >= 3) {
        ctx.moveTo(hole[0].x, hole[0].y);
        for (let i = 1; i < hole.length; i++) {
          ctx.lineTo(hole[i].x, hole[i].y);
        }
        ctx.closePath();
      }
    }
  }
  ctx.clip('evenodd');

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;

  if (angle !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(angle * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  switch (hatchPattern) {
    case 'diagonal-left':
      drawDiagonalLeft(ctx, left, top, right, bottom, spacing);
      break;
    case 'diagonal-right':
      drawDiagonalRight(ctx, left, top, right, bottom, spacing);
      break;
    case 'crosshatch':
      drawDiagonalLeft(ctx, left, top, right, bottom, spacing);
      drawDiagonalRight(ctx, left, top, right, bottom, spacing);
      break;
    case 'horizontal':
      drawHorizontal(ctx, left, top, right, bottom, spacing);
      break;
    case 'vertical':
      drawVertical(ctx, left, top, right, bottom, spacing);
      break;
    case 'dots':
      drawDots(ctx, left, top, right, bottom, spacing);
      break;
    case 'grid':
      drawHorizontal(ctx, left, top, right, bottom, spacing);
      drawVertical(ctx, left, top, right, bottom, spacing);
      break;
  }

  ctx.restore();
}

function drawDots(ctx, left, top, right, bottom, spacing) {
  const radius = 1.5;
  for (let y = top; y <= bottom; y += spacing) {
    for (let x = left; x <= right; x += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
