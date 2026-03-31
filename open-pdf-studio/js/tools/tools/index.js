/**
 * Tool registration — imports all tools and registers them in the tool-registry
 */
import { registerTool } from '../tool-registry.js';
import { handTool } from './hand-tool.js';
import { selectTool } from './select-tool.js';
import { drawTool } from './draw-tool.js';
import { shapeTool } from './shape-tool.js';
import { lineTool } from './line-tool.js';
import { polylineTool, cloudPolylineTool } from './polyline-tool.js';
import { measureDistanceTool, measureAreaTool, measurePerimeterTool, addHoleTool } from './measurement-tool.js';
import { measureAngleTool } from './angle-tool.js';
import { commentTool, textTool, stampTool, signatureTool, editTextTool } from './text-tool.js';
import { calibrationPickTool } from './calibration-pick-tool.js';
import { pluginClickTool } from './plugin-tool.js';
import { hoverTranslateTool } from './hover-translate-tool.js';
import { scaleBarTool } from './scalebar-tool.js';

export function registerAllTools() {
  // Navigation / selection
  registerTool('hand', handTool);
  registerTool('select', selectTool);
  registerTool('selectComments', selectTool);

  // Freehand
  registerTool('draw', drawTool);

  // Shapes (all use the same drag-to-create pattern)
  registerTool('box', shapeTool);
  registerTool('circle', shapeTool);
  registerTool('highlight', shapeTool);
  registerTool('cloud', shapeTool);
  registerTool('polygon', shapeTool);
  registerTool('redaction', shapeTool);
  registerTool('textbox', shapeTool);
  registerTool('callout', shapeTool);

  // Lines
  registerTool('line', lineTool);
  registerTool('arrow', lineTool);

  // Multi-click tools
  registerTool('polyline', polylineTool);
  registerTool('cloudPolyline', cloudPolylineTool);

  // Measurements
  registerTool('measureDistance', measureDistanceTool);
  registerTool('measureArea', measureAreaTool);
  registerTool('measurePerimeter', measurePerimeterTool);
  registerTool('measureAngle', measureAngleTool);
  registerTool('addHole', addHoleTool);

  // Calibration
  registerTool('calibrationPick', calibrationPickTool);

  // Scale bar
  registerTool('scaleBar', scaleBarTool);

  // Single-click placement
  registerTool('comment', commentTool);
  registerTool('text', textTool);
  registerTool('stamp', stampTool);
  registerTool('signature', signatureTool);
  registerTool('editText', editTextTool);

  // Plugin fallback
  registerTool('_plugin_click', pluginClickTool);

  // AI
  registerTool('hoverTranslate', hoverTranslateTool);
}
