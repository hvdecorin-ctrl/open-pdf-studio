import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { state } from '../../core/state.js';
import { recordPropertyChange } from '../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { formatDate, getTypeDisplayName } from '../../utils/helpers.js';
import i18next from '../../i18n/config.js';

// Panel visibility
const [panelVisible, setPanelVisible] = createSignal(false);

// Panel mode: 'none' | 'annotation' | 'multi' | 'textEdit'
const [panelMode, setPanelMode] = createSignal('none');

// Collapsed sections tracking
const [collapsedSections, setCollapsedSections] = createSignal({});

// Annotation properties store
const [annotProps, setAnnotProps] = createStore({
  type: '',
  typeDisplay: '',
  subject: '',
  author: '',
  created: '',
  modified: '',
  locked: false,
  printable: true,
  readOnly: false,
  marked: false,
  altText: '',
  status: 'none',
  color: '#000000',
  fillColor: null,
  strokeColor: '#000000',
  textColor: '#000000',
  lineWidth: 3,
  opacity: 100,
  icon: 'comment',
  borderStyle: 'solid',
  text: '',
  fontSize: 16,
  fontFamily: 'Arial',
  textFontSize: 14,
  fontBold: false,
  fontItalic: false,
  fontUnderline: false,
  fontStrikethrough: false,
  textAlign: 'left',
  lineSpacing: '1.5',
  rotation: 0,
  imageWidth: 0,
  imageHeight: 0,
  imageRotation: 0,
  lockAspectRatio: false,
  startHead: 'none',
  endHead: 'open',
  headSize: 12,
  arrowLength: '',
  replies: [],
  multiCount: 0,
});

// Section visibility store
const [sectionVis, setSectionVis] = createStore({
  general: false,
  replies: false,
  appearance: false,
  lineEndings: false,
  dimensions: false,
  textFormat: false,
  paragraph: false,
  content: false,
  image: false,
  actions: false,
  // Sub-group visibility
  iconGroup: false,
  fillColorGroup: false,
  strokeColorGroup: false,
  colorGroup: false,
  lineWidthGroup: false,
  borderStyleGroup: false,
  textGroup: false,
  fontSizeGroup: false,
  opacityGroup: true,
  rotationGroup: false,
});

// Document info store
const [docInfo, setDocInfo] = createStore({
  filename: '-',
  filepath: '-',
  pages: '-',
  pageSize: '-',
  title: '-',
  author: '-',
  subject: '-',
  creator: '-',
  producer: '-',
  version: '-',
  annotCount: '0',
  annotPage: '0',
});

// Current annotation reference for write-back
let currentAnnotation = null;

function redraw() {
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Compute section visibility based on annotation type
function computeSectionVisibility(type) {
  const isTextbox = ['textbox', 'callout'].includes(type);
  const isShape = ['line', 'arrow', 'box', 'circle', 'draw', 'textbox', 'callout'].includes(type);
  const isTextContent = type === 'text' || type === 'comment';
  const isImage = type === 'image';
  const isArrow = type === 'arrow';
  const isLineOrArrow = type === 'arrow' || type === 'line';
  const isTextMarkup = ['textHighlight', 'textStrikethrough', 'textUnderline'].includes(type);
  const hideLineWidth = ['highlight', 'comment', 'image', 'textHighlight'].includes(type);
  const hasFillColor = ['highlight', 'box', 'circle', 'textbox', 'callout', 'arrow', 'line'].includes(type);
  const hideColor = ['line', 'arrow', 'box', 'circle', 'draw', 'highlight', 'image', 'textbox', 'callout'].includes(type);
  const hasBorderStyle = ['textbox', 'callout', 'arrow', 'line'].includes(type);
  const hasRotation = ['box', 'circle', 'polygon', 'cloud', 'highlight', 'redaction', 'comment', 'stamp', 'signature'].includes(type);

  setSectionVis({
    general: true,
    replies: true,
    appearance: true,
    lineEndings: isArrow,
    dimensions: isLineOrArrow,
    textFormat: isTextbox,
    paragraph: isTextbox,
    content: isTextContent,
    image: isImage,
    actions: true,
    iconGroup: type === 'comment',
    fillColorGroup: hasFillColor,
    strokeColorGroup: isShape,
    colorGroup: !hideColor || isTextMarkup,
    lineWidthGroup: !hideLineWidth,
    borderStyleGroup: hasBorderStyle,
    textGroup: isTextContent,
    fontSizeGroup: type === 'text',
    opacityGroup: true,
    rotationGroup: hasRotation,
  });
}

// Show properties for a single annotation
export function storeShowProperties(annotation) {
  currentAnnotation = annotation;
  const isLocked = annotation.locked || false;

  setAnnotProps({
    type: annotation.type,
    typeDisplay: getTypeDisplayName(annotation.type),
    subject: annotation.subject || '',
    author: annotation.author || state.defaultAuthor,
    created: formatDate(annotation.createdAt),
    modified: formatDate(annotation.modifiedAt),
    locked: isLocked,
    printable: annotation.printable !== false,
    readOnly: annotation.readOnly || false,
    marked: annotation.marked || false,
    altText: annotation.altText || '',
    status: annotation.status || 'none',
    color: annotation.color || '#000000',
    fillColor: annotation.fillColor || null,
    strokeColor: annotation.strokeColor || annotation.color || '#000000',
    textColor: annotation.textColor || annotation.color || '#000000',
    lineWidth: annotation.lineWidth !== undefined ? annotation.lineWidth : 3,
    opacity: annotation.opacity !== undefined ? Math.round(annotation.opacity * 100) : 100,
    icon: annotation.icon || 'comment',
    borderStyle: annotation.borderStyle || 'solid',
    text: annotation.text || '',
    fontSize: annotation.fontSize || 16,
    fontFamily: annotation.fontFamily || 'Arial',
    textFontSize: annotation.fontSize || 14,
    fontBold: annotation.fontBold || false,
    fontItalic: annotation.fontItalic || false,
    fontUnderline: annotation.fontUnderline || false,
    fontStrikethrough: annotation.fontStrikethrough || false,
    textAlign: annotation.textAlign || 'left',
    lineSpacing: annotation.lineSpacing || '1.5',
    rotation: annotation.rotation || 0,
    imageWidth: annotation.type === 'image' ? Math.round(annotation.width) : 0,
    imageHeight: annotation.type === 'image' ? Math.round(annotation.height) : 0,
    imageRotation: annotation.type === 'image' ? Math.round(annotation.rotation || 0) : 0,
    lockAspectRatio: annotation.type === 'image' ? (annotation.lockAspectRatio || false) : false,
    startHead: annotation.startHead || 'none',
    endHead: annotation.endHead || 'open',
    headSize: annotation.headSize || 12,
    arrowLength: (annotation.type === 'arrow' || annotation.type === 'line')
      ? (Math.sqrt(Math.pow(annotation.endX - annotation.startX, 2) + Math.pow(annotation.endY - annotation.startY, 2))).toFixed(2) + ' px'
      : '',
    replies: annotation.replies || [],
    multiCount: 0,
  });

  computeSectionVisibility(annotation.type);
  setPanelMode('annotation');
  setPanelVisible(true);
}

// Hide properties (deselect annotation, show doc info)
export function storeHideProperties() {
  currentAnnotation = null;
  setPanelMode('none');

  // Hide all annotation sections
  setSectionVis({
    general: false,
    replies: false,
    appearance: false,
    lineEndings: false,
    dimensions: false,
    textFormat: false,
    paragraph: false,
    content: false,
    image: false,
    actions: false,
    iconGroup: false,
    fillColorGroup: false,
    strokeColorGroup: false,
    colorGroup: false,
    lineWidthGroup: false,
    borderStyleGroup: false,
    textGroup: false,
    fontSizeGroup: false,
    opacityGroup: false,
    rotationGroup: false,
  });

  populateDocInfo();
}

// Close the panel entirely
export function storeClosePanel() {
  currentAnnotation = null;
  setPanelVisible(false);
}

// Show multi-selection properties
export function storeShowMultiSelection(selected) {
  if (!selected || selected.length < 2) return;
  currentAnnotation = null;

  setAnnotProps({
    type: '',
    typeDisplay: i18next.t('multiSelect', { count: selected.length, ns: 'properties' }),
    subject: '',
    author: '',
    created: '',
    modified: '',
    locked: false,
    printable: true,
    readOnly: false,
    marked: false,
    altText: '',
    status: 'none',
    color: '#000000',
    fillColor: null,
    strokeColor: '#000000',
    textColor: '#000000',
    lineWidth: 3,
    opacity: selected[0].opacity !== undefined ? Math.round(selected[0].opacity * 100) : 100,
    icon: 'comment',
    borderStyle: 'solid',
    text: '',
    fontSize: 16,
    fontFamily: 'Arial',
    textFontSize: 14,
    fontBold: false,
    fontItalic: false,
    fontUnderline: false,
    fontStrikethrough: false,
    textAlign: 'left',
    lineSpacing: '1.5',
    rotation: 0,
    imageWidth: 0,
    imageHeight: 0,
    imageRotation: 0,
    lockAspectRatio: false,
    startHead: 'none',
    endHead: 'open',
    headSize: 12,
    arrowLength: '',
    replies: [],
    multiCount: selected.length,
  });

  setSectionVis({
    general: true,
    replies: false,
    appearance: true,
    lineEndings: false,
    dimensions: false,
    textFormat: false,
    paragraph: false,
    content: false,
    image: false,
    actions: true,
    iconGroup: false,
    fillColorGroup: false,
    strokeColorGroup: false,
    colorGroup: false,
    lineWidthGroup: false,
    borderStyleGroup: false,
    textGroup: false,
    fontSizeGroup: false,
    opacityGroup: true,
    rotationGroup: false,
  });

  setPanelMode('multi');
  setPanelVisible(true);
}

// Show text edit properties (PDF text editing mode)
export function storeShowTextEditProperties(info) {
  const ff = (info.fontFamily || 'Helvetica').toLowerCase();
  let displayFontFamily;
  if (ff.includes('courier') || ff.includes('consolas') || ff.includes('mono')) {
    displayFontFamily = 'Courier New';
  } else if (ff.includes('times') || ff.includes('garamond') || ff.includes('georgia')
      || ff.includes('palatino') || ff.includes('cambria') || ff.includes('bookman')) {
    displayFontFamily = 'Times New Roman';
  } else if (ff.includes('calibri')) {
    displayFontFamily = 'Calibri';
  } else if (ff.includes('verdana')) {
    displayFontFamily = 'Verdana';
  } else if (ff.includes('tahoma')) {
    displayFontFamily = 'Tahoma';
  } else if (ff.includes('trebuchet')) {
    displayFontFamily = 'Trebuchet MS';
  } else if (ff.includes('segoe')) {
    displayFontFamily = 'Segoe UI';
  } else if (ff.includes('comic')) {
    displayFontFamily = 'Comic Sans MS';
  } else if (ff.includes('impact')) {
    displayFontFamily = 'Impact';
  } else if (ff.includes('arial') || ff.includes('helvetica')) {
    displayFontFamily = 'Arial';
  } else {
    let cleaned = info.fontFamily || 'Arial';
    cleaned = cleaned.replace(/[-,](Bold|Italic|Oblique|Regular|Medium|Light|Book|Roman|PSMT|MT|PS).*$/i, '');
    cleaned = cleaned.replace(/PSMT$|MT$/i, '');
    displayFontFamily = cleaned || 'Arial';
  }

  const pseudoAnnotation = {
    type: 'textbox',
    id: '_pdfTextEdit',
    text: info.text || '',
    fontSize: info.fontSize || 12,
    fontFamily: displayFontFamily,
    textColor: info.color || '#000000',
    color: info.color || '#000000',
    fontBold: info.isBold || false,
    fontItalic: info.isItalic || false,
    fontUnderline: false,
    fontStrikethrough: false,
    textAlign: 'left',
    lineSpacing: '1.2',
    lineWidth: 0,
    opacity: 1,
    fillColor: null,
    strokeColor: null,
    locked: false,
    printable: true,
    page: info.page || 1,
    subject: i18next.t('pdfText', { ns: 'properties' }),
    author: '',
    createdAt: '',
    modifiedAt: ''
  };

  currentAnnotation = pseudoAnnotation;

  // First show as textbox to get text format section
  storeShowProperties(pseudoAnnotation);

  // Override type display and hide irrelevant sections
  setAnnotProps('typeDisplay', i18next.t('pdfText', { ns: 'properties' }));
  setAnnotProps('textFontSize', Math.round(info.fontSize || 12));

  setSectionVis({
    general: false,
    replies: false,
    appearance: false,
    lineEndings: false,
    dimensions: false,
    textFormat: true,
    paragraph: false,
    content: false,
    image: false,
    actions: false,
    iconGroup: false,
    fillColorGroup: false,
    strokeColorGroup: false,
    colorGroup: false,
    lineWidthGroup: false,
    borderStyleGroup: false,
    textGroup: false,
    fontSizeGroup: false,
    opacityGroup: false,
    rotationGroup: false,
  });

  setPanelMode('textEdit');
}

// Populate document info
export async function populateDocInfo() {
  const filePath = state.currentPdfPath || '';
  if (filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    setDocInfo('filename', parts[parts.length - 1]);
    setDocInfo('filepath', filePath);
  } else {
    setDocInfo('filename', i18next.t('docInfo.noFileOpen', { ns: 'properties' }));
    setDocInfo('filepath', '-');
  }

  if (state.pdfDoc) {
    setDocInfo('pages', `${state.currentPage} / ${state.pdfDoc.numPages}`);
    try {
      const page = await state.pdfDoc.getPage(state.currentPage);
      const vp = page.getViewport({ scale: 1 });
      const wMm = (vp.width / 72 * 25.4).toFixed(1);
      const hMm = (vp.height / 72 * 25.4).toFixed(1);
      setDocInfo('pageSize', `${wMm} x ${hMm} mm`);
    } catch (e) {
      setDocInfo('pageSize', '-');
    }

    try {
      const metadata = await state.pdfDoc.getMetadata();
      const info = metadata.info || {};
      setDocInfo('title', info.Title || '-');
      setDocInfo('author', info.Author || '-');
      setDocInfo('subject', info.Subject || '-');
      setDocInfo('creator', info.Creator || '-');
      setDocInfo('producer', info.Producer || '-');
      setDocInfo('version', info.PDFFormatVersion || '-');
    } catch (e) { /* ignore */ }
  } else {
    setDocInfo('pages', '-');
    setDocInfo('pageSize', '-');
  }

  const total = state.annotations.length;
  const onPage = state.annotations.filter(a => a.page === state.currentPage).length;
  setDocInfo('annotCount', String(total));
  setDocInfo('annotPage', i18next.t('docInfo.onPageCount', { count: onPage, page: state.currentPage, ns: 'properties' }));
}

// Update a single annotation property (write to store + annotation + undo + redraw)
export function updateAnnotProp(key, value) {
  if (!currentAnnotation) return;

  // Special handling for locked toggle
  if (key === 'locked' && currentAnnotation.locked && value === false) {
    currentAnnotation.locked = false;
    currentAnnotation.modifiedAt = new Date().toISOString();
    storeShowProperties(currentAnnotation);
    redraw();
    return;
  }

  if (currentAnnotation.locked) return;

  recordPropertyChange(currentAnnotation);
  currentAnnotation.modifiedAt = new Date().toISOString();

  // Write to annotation object
  switch (key) {
    case 'subject': currentAnnotation.subject = value; break;
    case 'author': currentAnnotation.author = value; break;
    case 'locked': currentAnnotation.locked = value; break;
    case 'printable': currentAnnotation.printable = value; break;
    case 'readOnly': currentAnnotation.readOnly = value; break;
    case 'marked': currentAnnotation.marked = value; break;
    case 'altText': currentAnnotation.altText = value; break;
    case 'status': currentAnnotation.status = value === 'none' ? undefined : value; break;
    case 'color': currentAnnotation.color = value; break;
    case 'fillColor': currentAnnotation.fillColor = value; break;
    case 'strokeColor': currentAnnotation.strokeColor = value; break;
    case 'lineWidth': currentAnnotation.lineWidth = parseFloat(value); break;
    case 'opacity':
      currentAnnotation.opacity = parseInt(value) / 100;
      break;
    case 'icon': currentAnnotation.icon = value; break;
    case 'borderStyle': currentAnnotation.borderStyle = value; break;
    case 'text': currentAnnotation.text = value; break;
    case 'fontSize': currentAnnotation.fontSize = parseInt(value); break;
    case 'textColor':
      currentAnnotation.textColor = value;
      currentAnnotation.color = value;
      break;
    case 'fontFamily': currentAnnotation.fontFamily = value; break;
    case 'textFontSize': currentAnnotation.fontSize = parseInt(value); break;
    case 'fontBold': currentAnnotation.fontBold = value; break;
    case 'fontItalic': currentAnnotation.fontItalic = value; break;
    case 'fontUnderline': currentAnnotation.fontUnderline = value; break;
    case 'fontStrikethrough': currentAnnotation.fontStrikethrough = value; break;
    case 'textAlign': currentAnnotation.textAlign = value; break;
    case 'lineSpacing': currentAnnotation.lineSpacing = parseFloat(value); break;
    case 'rotation': currentAnnotation.rotation = parseInt(value) || 0; break;
    case 'imageWidth': {
      const newW = parseInt(value) || 20;
      currentAnnotation.width = newW;
      if (currentAnnotation.lockAspectRatio && currentAnnotation.originalWidth && currentAnnotation.originalHeight) {
        const ratio = currentAnnotation.originalWidth / currentAnnotation.originalHeight;
        const newH = Math.round(newW / ratio);
        currentAnnotation.height = Math.max(20, newH);
        setAnnotProps('imageHeight', currentAnnotation.height);
      }
      break;
    }
    case 'imageHeight': {
      const newH = parseInt(value) || 20;
      currentAnnotation.height = newH;
      if (currentAnnotation.lockAspectRatio && currentAnnotation.originalWidth && currentAnnotation.originalHeight) {
        const ratio = currentAnnotation.originalWidth / currentAnnotation.originalHeight;
        const newW = Math.round(newH * ratio);
        currentAnnotation.width = Math.max(20, newW);
        setAnnotProps('imageWidth', currentAnnotation.width);
      }
      break;
    }
    case 'imageRotation': currentAnnotation.rotation = parseInt(value) || 0; break;
    case 'lockAspectRatio': {
      currentAnnotation.lockAspectRatio = value;
      if (value && currentAnnotation.type === 'image' && currentAnnotation.originalWidth && currentAnnotation.originalHeight) {
        const ratio = currentAnnotation.originalWidth / currentAnnotation.originalHeight;
        const newH = Math.round(currentAnnotation.width / ratio);
        currentAnnotation.height = Math.max(20, newH);
        setAnnotProps('imageHeight', currentAnnotation.height);
      }
      break;
    }
    case 'startHead': currentAnnotation.startHead = value; break;
    case 'endHead': currentAnnotation.endHead = value; break;
    case 'headSize': currentAnnotation.headSize = parseInt(value); break;
  }

  // Update store
  setAnnotProps(key, value);

  redraw();
}

// Toggle section collapse
export function toggleSection(name) {
  setCollapsedSections(prev => ({ ...prev, [name]: !prev[name] }));
}

// Add a reply to current annotation
export function addReply(text) {
  if (!currentAnnotation || !text.trim()) return;
  if (!currentAnnotation.replies) currentAnnotation.replies = [];
  currentAnnotation.replies.push({
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    author: state.defaultAuthor || 'User',
    text: text.trim(),
    createdAt: new Date().toISOString()
  });
  currentAnnotation.modifiedAt = new Date().toISOString();
  setAnnotProps('replies', [...currentAnnotation.replies]);
  setAnnotProps('modified', formatDate(currentAnnotation.modifiedAt));
}

// Delete a reply
export function deleteReply(index) {
  if (!currentAnnotation || !currentAnnotation.replies) return;
  currentAnnotation.replies.splice(index, 1);
  currentAnnotation.modifiedAt = new Date().toISOString();
  setAnnotProps('replies', [...currentAnnotation.replies]);
  setAnnotProps('modified', formatDate(currentAnnotation.modifiedAt));
}

// Cycle a <select> to the next option on double-click
export function cycleSelectNext(e) {
  const sel = e.currentTarget;
  const nextIdx = (sel.selectedIndex + 1) % sel.options.length;
  sel.selectedIndex = nextIdx;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

// Reset image to original size
export function resetImageSize() {
  if (!currentAnnotation || currentAnnotation.type !== 'image') return;
  recordPropertyChange(currentAnnotation);
  currentAnnotation.width = currentAnnotation.originalWidth;
  currentAnnotation.height = currentAnnotation.originalHeight;
  currentAnnotation.rotation = 0;
  currentAnnotation.modifiedAt = new Date().toISOString();
  storeShowProperties(currentAnnotation);
  redraw();
}

// Update opacity with Ctrl-snap support
export function updateOpacity(value, ctrlKey) {
  let finalValue = parseInt(value);
  if (ctrlKey) {
    finalValue = Math.round(finalValue / 10) * 10;
  }
  updateAnnotProp('opacity', finalValue);
}

// Get line width label based on type
export function getLineWidthLabel() {
  const type = annotProps.type;
  return ['textbox', 'callout', 'box', 'circle', 'polygon', 'cloud'].includes(type)
    ? i18next.t('appearance.borderWidth', { ns: 'properties' })
    : i18next.t('appearance.lineWidth', { ns: 'properties' });
}

// Get the current annotation reference
export function getCurrentAnnotation() {
  return currentAnnotation;
}

export {
  panelVisible, setPanelVisible,
  panelMode, setPanelMode,
  collapsedSections,
  annotProps, setAnnotProps,
  sectionVis, setSectionVis,
  docInfo,
};
