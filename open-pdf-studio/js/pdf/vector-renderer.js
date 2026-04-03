/**
 * Vector renderer: plays back binary draw commands on Canvas2D.
 * Commands are produced by open-pdf-render (Rust) and transferred as a Uint8Array.
 *
 * Binary format (all values little-endian):
 *   Header: f32 pageWidth, f32 pageHeight (8 bytes)
 *   Then a sequence of commands, each starting with a u8 opcode:
 *     0  MoveTo(f32 x, f32 y)
 *     1  LineTo(f32 x, f32 y)
 *     2  CubicTo(f32 x1, y1, x2, y2, x3, y3)
 *     3  Rect(f32 x, y, w, h)
 *     4  ClosePath
 *     5  SetStroke(u32 rgba, f32 width)
 *     6  SetFill(u32 rgba)
 *     7  Stroke
 *     8  Fill
 *     9  FillEvenOdd
 *    10  Save
 *    11  Restore
 *    12  Transform(f32 a, b, c, d, e, f)
 *    13  SetLineCap(u8)
 *    14  SetLineJoin(u8)
 *    15  SetMiterLimit(f32)
 *    16  SetDash(u8 count, count*f32, f32 phase)
 *    17  BeginPath
 */

// Cache: Map<"filePath:pageNum", { bytes: Uint8Array, w: number, h: number }>
const _cache = new Map();

function _key(filePath, pageNum) {
  return filePath + ':' + pageNum;
}

export function clearVectorCache() {
  _cache.clear();
}

export function cacheCommands(filePath, pageNum, rawBytes) {
  const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  if (bytes.length < 16) return;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 16-byte header: x0, y0, width, height (all f32 LE)
  const x0 = dv.getFloat32(0, true);
  const y0 = dv.getFloat32(4, true);
  const w = dv.getFloat32(8, true);
  const h = dv.getFloat32(12, true);
  _cache.set(_key(filePath, pageNum), { bytes, x0, y0, w, h });
}

export function hasCachedCommands(filePath, pageNum) {
  return _cache.has(_key(filePath, pageNum));
}

export function getCachedPageDimensions(filePath, pageNum) {
  const entry = _cache.get(_key(filePath, pageNum));
  if (!entry) return null;
  return { x0: entry.x0, y0: entry.y0, w: entry.w, h: entry.h };
}

function _rgbaToCSS(rgba) {
  const r = (rgba >>> 24) & 0xFF;
  const g = (rgba >>> 16) & 0xFF;
  const b = (rgba >>> 8) & 0xFF;
  const a = (rgba & 0xFF) / 255;
  return `rgba(${r},${g},${b},${a})`;
}

const LINE_CAP = ['butt', 'round', 'square'];
const LINE_JOIN = ['miter', 'round', 'bevel'];

export function renderVectorPage(ctx, filePath, pageNum, transform) {
  const entry = _cache.get(_key(filePath, pageNum));
  if (!entry) return;

  const { bytes, x0, y0, h: pageH } = entry;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 16; // skip 16-byte header (x0, y0, w, h)

  // Apply caller transform, then Y-flip, then translate to MediaBox origin
  // PDF content is drawn in MediaBox coordinates (which can start at -846, -595 etc.)
  ctx.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  ctx.transform(1, 0, 0, -1, 0, pageH);   // Y-flip
  ctx.translate(-x0, -y0);                  // Shift to MediaBox origin

  while (pos < bytes.length) {
    const op = bytes[pos++];
    switch (op) {
      case 0: { // MoveTo
        const x = dv.getFloat32(pos, true); pos += 4;
        const y = dv.getFloat32(pos, true); pos += 4;
        ctx.moveTo(x, y);
        break;
      }
      case 1: { // LineTo
        const x = dv.getFloat32(pos, true); pos += 4;
        const y = dv.getFloat32(pos, true); pos += 4;
        ctx.lineTo(x, y);
        break;
      }
      case 2: { // CubicTo
        const x1 = dv.getFloat32(pos, true); pos += 4;
        const y1 = dv.getFloat32(pos, true); pos += 4;
        const x2 = dv.getFloat32(pos, true); pos += 4;
        const y2 = dv.getFloat32(pos, true); pos += 4;
        const x3 = dv.getFloat32(pos, true); pos += 4;
        const y3 = dv.getFloat32(pos, true); pos += 4;
        ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
        break;
      }
      case 3: { // Rect
        const x = dv.getFloat32(pos, true); pos += 4;
        const y = dv.getFloat32(pos, true); pos += 4;
        const w = dv.getFloat32(pos, true); pos += 4;
        const h = dv.getFloat32(pos, true); pos += 4;
        ctx.rect(x, y, w, h);
        break;
      }
      case 4: // ClosePath
        ctx.closePath();
        break;
      case 5: { // SetStroke(rgba, width)
        const rgba = dv.getUint32(pos, true); pos += 4;
        const w = dv.getFloat32(pos, true); pos += 4;
        ctx.strokeStyle = _rgbaToCSS(rgba);
        ctx.lineWidth = w;
        break;
      }
      case 6: { // SetFill(rgba)
        const rgba = dv.getUint32(pos, true); pos += 4;
        ctx.fillStyle = _rgbaToCSS(rgba);
        break;
      }
      case 7: // Stroke
        ctx.stroke();
        break;
      case 8: // Fill
        ctx.fill('nonzero');
        break;
      case 9: // FillEvenOdd
        ctx.fill('evenodd');
        break;
      case 10: // Save
        ctx.save();
        break;
      case 11: // Restore
        ctx.restore();
        break;
      case 12: { // Transform
        const a = dv.getFloat32(pos, true); pos += 4;
        const b = dv.getFloat32(pos, true); pos += 4;
        const c = dv.getFloat32(pos, true); pos += 4;
        const d = dv.getFloat32(pos, true); pos += 4;
        const e = dv.getFloat32(pos, true); pos += 4;
        const f = dv.getFloat32(pos, true); pos += 4;
        ctx.transform(a, b, c, d, e, f);
        break;
      }
      case 13: { // SetLineCap
        const cap = bytes[pos++];
        ctx.lineCap = LINE_CAP[cap] || 'butt';
        break;
      }
      case 14: { // SetLineJoin
        const join = bytes[pos++];
        ctx.lineJoin = LINE_JOIN[join] || 'miter';
        break;
      }
      case 15: { // SetMiterLimit
        const limit = dv.getFloat32(pos, true); pos += 4;
        ctx.miterLimit = limit;
        break;
      }
      case 16: { // SetDash
        const count = bytes[pos++];
        const pattern = [];
        for (let i = 0; i < count; i++) {
          pattern.push(dv.getFloat32(pos, true)); pos += 4;
        }
        const phase = dv.getFloat32(pos, true); pos += 4;
        ctx.setLineDash(pattern);
        ctx.lineDashOffset = phase;
        break;
      }
      case 17: // BeginPath
        ctx.beginPath();
        break;
      default:
        console.warn(`[vector-renderer] Unknown opcode ${op} at position ${pos - 1}`);
        return; // bail out on unknown command
    }
  }
}
