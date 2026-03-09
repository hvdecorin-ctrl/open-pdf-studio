import { state } from '../core/state.js';
import { createAnnotation } from './factory.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { openDialog } from '../bridge.js';

// Built-in stamp definitions
export const BUILT_IN_STAMPS = [
  { name: 'Approved', color: '#22c55e', text: 'APPROVED' },
  { name: 'Rejected', color: '#ef4444', text: 'REJECTED' },
  { name: 'Draft', color: '#3b82f6', text: 'DRAFT' },
  { name: 'Confidential', color: '#ef4444', text: 'CONFIDENTIAL' },
  { name: 'Final', color: '#22c55e', text: 'FINAL' },
  { name: 'For Review', color: '#f59e0b', text: 'FOR REVIEW' },
  { name: 'Not Approved', color: '#ef4444', text: 'NOT APPROVED' },
  { name: 'Void', color: '#6b7280', text: 'VOID' },
  { name: 'As Is', color: '#6b7280', text: 'AS IS' },
  { name: 'Revised', color: '#8b5cf6', text: 'REVISED' }
];

// Show stamp picker dialog
export function showStampPicker(x, y) {
  openDialog('stamp-picker', {
    onSelect: (stamp) => placeStamp(stamp, x, y),
    onCustom: () => loadCustomStamp(x, y)
  });
}

// Place a built-in stamp
function placeStamp(stamp, x, y) {
  if (!state.pdfDoc) return;

  const width = 160;
  const height = 50;

  const ann = createAnnotation({
    type: 'stamp',
    page: state.currentPage,
    x: x - width / 2,
    y: y - height / 2,
    width: width,
    height: height,
    stampName: stamp.name,
    stampText: stamp.text,
    stampColor: stamp.color,
    color: stamp.color,
    strokeColor: stamp.color,
    opacity: 0.85,
    rotation: 0
  });

  state.annotations.push(ann);
  recordAdd(ann);

  if (state.preferences.autoSelectAfterCreate) {
    state.selectedAnnotation = ann;
    showProperties(ann);
  }

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage(`Stamp "${stamp.name}" placed`);
}

// North arrow SVG template
const NORTH_ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 130">
  <text x="50" y="17" text-anchor="middle" font-size="22" font-weight="900" font-family="Arial,Helvetica,sans-serif" fill="#000">N</text>
  <polygon points="50,24 35,72 50,72 50,96" fill="#000" stroke="#000" stroke-width="1" stroke-linejoin="miter"/>
  <polygon points="50,24 65,72 50,72" fill="none" stroke="#000" stroke-width="1" stroke-linejoin="miter"/>
  <polygon points="50,72 65,72 50,96" fill="none" stroke="#000" stroke-width="1" stroke-linejoin="miter"/>
  <line x1="12" y1="72" x2="35" y2="72" stroke="#000" stroke-width="1.2"/>
  <line x1="65" y1="72" x2="88" y2="72" stroke="#000" stroke-width="1.2"/>
  <text x="7" y="77" text-anchor="middle" font-size="15" font-weight="bold" font-family="Arial,Helvetica,sans-serif" fill="#000">W</text>
  <text x="93" y="77" text-anchor="middle" font-size="15" font-weight="bold" font-family="Arial,Helvetica,sans-serif" fill="#000">O</text>
  <text x="50" y="114" text-anchor="middle" font-size="15" font-weight="bold" font-family="Arial,Helvetica,sans-serif" fill="#000">Z</text>
</svg>`;

// Create and cache north arrow image (preload so it's ready on first click)
let northArrowImg = null;
function getNorthArrowImage() {
  if (northArrowImg) return northArrowImg;
  const blob = new Blob([NORTH_ARROW_SVG], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  northArrowImg = new Image();
  northArrowImg.src = url;
  return northArrowImg;
}
// Preload immediately
getNorthArrowImage();

// Place north arrow symbol
export function placeNorthArrow(x, y) {
  if (!state.pdfDoc) return;

  const width = 65;
  const height = 85;
  const img = getNorthArrowImage();

  const imageId = 'northArrow';
  if (!state.imageCache.has(imageId)) {
    state.imageCache.set(imageId, img);
  }

  const ann = createAnnotation({
    type: 'stamp',
    page: state.currentPage,
    x: x - width / 2,
    y: y - height / 2,
    width: width,
    height: height,
    stampName: 'NorthArrow',
    stampText: '',
    imageId: imageId,
    originalWidth: 100,
    originalHeight: 130,
    color: '#000000',
    opacity: 1,
    rotation: 0,
    lockAspectRatio: true
  });

  state.annotations.push(ann);
  recordAdd(ann);

  if (state.preferences.autoSelectAfterCreate) {
    state.selectedAnnotation = ann;
    showProperties(ann);
  }

  const redraw = () => {
    if (state.viewMode === 'continuous') redrawContinuous();
    else redrawAnnotations();
  };

  if (!img.complete) {
    img.onload = redraw;
  }
  redraw();

  updateStatusMessage('North arrow placed');
}

// Load custom stamp from image file
async function loadCustomStamp(x, y) {
  try {
    const { openFileDialog } = await import('../core/platform.js');
    const filePath = await openFileDialog(['png', 'jpg', 'jpeg', 'bmp', 'gif', 'svg']);
    if (!filePath) return;

    const { readBinaryFile } = await import('../core/platform.js');
    const data = await readBinaryFile(filePath);
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

    const { generateImageId } = await import('../utils/helpers.js');
    const imageId = generateImageId();
    state.imageCache.set(imageId, img);

    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const maxSize = 200;
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width *= ratio;
      height *= ratio;
    }

    const ann = createAnnotation({
      type: 'stamp',
      page: state.currentPage,
      x: x - width / 2,
      y: y - height / 2,
      width: width,
      height: height,
      stampName: 'Custom',
      stampText: '',
      imageId: imageId,
      imageData: url,
      originalWidth: img.naturalWidth,
      originalHeight: img.naturalHeight,
      color: '#000000',
      opacity: 1,
      rotation: 0
    });

    state.annotations.push(ann);
    recordAdd(ann);

    if (state.preferences.autoSelectAfterCreate) {
      state.selectedAnnotation = ann;
      showProperties(ann);
    }

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    updateStatusMessage('Custom stamp placed');
  } catch (err) {
    console.error('Failed to load custom stamp:', err);
  }
}
