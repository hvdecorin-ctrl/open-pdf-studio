// Save a screenshot from app_screenshot_view to a PNG file for inspection.
import { writeFile } from 'fs/promises';
const MCP = 'http://127.0.0.1:9223/mcp';
const OUT = process.argv[2] || 'C:/Users/rickd/AppData/Local/Temp/claude/screenshot.png';

const r = await fetch(MCP, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'app_screenshot_view', arguments: { width: 800 } },
  }),
});
const j = await r.json();
const text = j?.result?.content?.[0]?.text;
const obj = JSON.parse(text);
const buf = Buffer.from(obj.png_base64, 'base64');
await writeFile(OUT, buf);
console.log(`Saved ${buf.length} bytes (${obj.width}x${obj.height}) to ${OUT}`);
