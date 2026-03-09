// Draw arrowhead at specified position
export function drawArrowheadOnCanvas(ctx, x, y, angle, size, style) {
  const halfAngle = Math.PI / 6; // 30 degrees

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;

  ctx.beginPath();
  if (style === 'open' || style === 'stealth') {
    // Open arrow style - two lines
    ctx.moveTo(-size, -size * Math.tan(halfAngle));
    ctx.lineTo(0, 0);
    ctx.lineTo(-size, size * Math.tan(halfAngle));
    ctx.stroke();
  } else if (style === 'closed') {
    // Closed/filled arrow style - triangle
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * Math.tan(halfAngle));
    ctx.lineTo(-size, size * Math.tan(halfAngle));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 'diamond') {
    // Diamond style
    const halfSize = size / 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(-halfSize, -halfSize * 0.6);
    ctx.lineTo(-size, 0);
    ctx.lineTo(-halfSize, halfSize * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 'circle') {
    // Circle style
    const radius = size / 3;
    ctx.arc(-radius, 0, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  } else if (style === 'square') {
    // Square style
    const halfSize = size / 3;
    ctx.rect(-size / 2 - halfSize, -halfSize, halfSize * 2, halfSize * 2);
    ctx.fill();
    ctx.stroke();
  } else if (style === 'slash') {
    // Slash style - perpendicular line
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(0, size / 2);
    ctx.stroke();
  }

  ctx.restore();
}

// Apply border style (dashed/dotted/solid and extended patterns) to canvas context
export function applyBorderStyle(ctx, borderStyle) {
  switch (borderStyle) {
    case 'dashed':
      ctx.setLineDash([8, 4]);
      break;
    case 'dotted':
      ctx.setLineDash([2, 2]);
      break;
    case 'dash-dot':
      ctx.setLineDash([8, 4, 2, 4]);
      break;
    case 'dash-dot-dot':
      ctx.setLineDash([8, 4, 2, 4, 2, 4]);
      break;
    case 'long-dash':
      ctx.setLineDash([16, 6]);
      break;
    case 'long-dash-dot':
      ctx.setLineDash([16, 6, 2, 6]);
      break;
    case 'long-dash-dot-dot':
      ctx.setLineDash([16, 6, 2, 6, 2, 6]);
      break;
    default:
      ctx.setLineDash([]);
      break;
  }
}
