// Spawns `tauri dev` with --mcp-server, waits until port 9223 responds,
// runs the python harness, then kills the dev process.
//
// Run from `open-pdf-studio/` via `npm run test:render:auto`. The orchestrator
// itself uses paths relative to its own location (`scripts/`), so it can be
// invoked from anywhere — but the npm wrapper's cwd is `open-pdf-studio/`.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);                   // <repo>/scripts
const REPO_ROOT  = path.resolve(__dirname, '..');              // <repo>
const TAURI_DIR  = path.join(REPO_ROOT, 'open-pdf-studio');
const HARNESS_PY = path.join(__dirname, 'render-regression-test.py');
const VENV_PY    = path.join(__dirname, '.venv-test', 'Scripts', 'python.exe');

const PORT = 9223;
const MAX_WAIT_MS = 180_000;

function waitForPort(port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const s = net.createConnection(port, '127.0.0.1');
      s.once('connect', () => { s.end(); resolve(); });
      s.once('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`port ${port} did not open within ${timeoutMs}ms`));
        } else {
          setTimeout(tick, 500);
        }
      });
    };
    tick();
  });
}

console.log(`[run-render-regression] tauri dir: ${TAURI_DIR}`);
console.log(`[run-render-regression] spawning tauri dev with --mcp-server`);

// `npm run tauri dev -- --mcp-server` passes --mcp-server through to the binary
// (tauri-cli forwards everything after the second `--` to the spawned exe).
const dev = spawn(
  'npm',
  ['run', 'tauri', 'dev', '--', '--', '--mcp-server'],
  { cwd: TAURI_DIR, stdio: 'inherit', shell: true },
);

let cleaned = false;
function cleanup(code) {
  if (cleaned) return;
  cleaned = true;
  try { dev.kill('SIGTERM'); } catch (_) {}
  process.exit(code);
}
process.on('SIGINT',  () => cleanup(130));
process.on('SIGTERM', () => cleanup(143));

dev.on('exit', (code) => {
  if (!cleaned) {
    console.error(`[run-render-regression] tauri dev exited prematurely (code ${code})`);
    cleanup(code ?? 1);
  }
});

try {
  console.log(`[run-render-regression] waiting for port ${PORT} (up to ${MAX_WAIT_MS / 1000}s)…`);
  await waitForPort(PORT, MAX_WAIT_MS);
  console.log(`[run-render-regression] port up; running harness`);

  const harness = spawn(
    VENV_PY,
    [HARNESS_PY, ...process.argv.slice(2)],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  const code = await new Promise((r) => harness.on('exit', r));
  console.log(`[run-render-regression] harness exit ${code}`);
  cleanup(code ?? 0);
} catch (e) {
  console.error(`[run-render-regression] ${e.message}`);
  cleanup(1);
}
