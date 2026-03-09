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
