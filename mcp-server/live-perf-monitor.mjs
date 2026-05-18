// Poll MCP console buffer, emit new [PERF] / [render] / [thumb] / [tile] /
// [bitmap-orch] events as they appear. One line per event (newline-separated)
// → each becomes a Monitor notification in the controlling agent.

const MCP = 'http://127.0.0.1:9223/mcp';
let lastSeenTs = Date.now();

async function poll() {
  try {
    const r = await fetch(MCP, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
        params: { name: 'app_get_recent_console', arguments: { since: lastSeenTs + 1 } },
      }),
    });
    const j = await r.json();
    const t = JSON.parse(j?.result?.content?.[0]?.text || '{}');
    const entries = t?.entries || [];
    for (const e of entries) {
      // Print with short timestamp
      const d = new Date(e.t);
      const hms = d.toTimeString().slice(0, 8);
      console.log(`${hms} ${e.text.slice(0, 180)}`);
      if (e.t > lastSeenTs) lastSeenTs = e.t;
    }
  } catch (e) {
    // Silent — don't spam notifications when app is down
  }
}

(async () => {
  while (true) {
    await poll();
    await new Promise(r => setTimeout(r, 500));
  }
})();
