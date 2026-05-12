// pocs/shared/measure-baseline.mjs
//
// Establish baseline measurements on de main branch BEFORE any PoC implementation.
// Saves results to pocs/shared/baseline-<timestamp>.json so every PoC can compare against.
//
// Runs all 4 scenarios on alle fixtures uit corpus.json.
//
// Usage:
//   node pocs/shared/measure-baseline.mjs
//
// Output: pocs/shared/baseline-<ISO timestamp>.json + summary on stdout.

import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(__dirname, 'corpus.json'), 'utf-8'));

const BENCH = join(__dirname, 'bench-harness.mjs');

console.log('═══ Baseline measurement — Open PDF Studio render pipeline ═══');
console.log(`Fixtures: ${corpus.fixtures.map(f => f.name).join(', ')}`);
console.log(`Scenarios: ${corpus.scenarios.map(s => s.name).join(', ')}\n`);

const results = {
  timestamp: new Date().toISOString(),
  git_sha: getCurrentGitSha(),
  baseline_runs: [],
};

for (const fixture of corpus.fixtures) {
  for (const scenario of corpus.scenarios) {
    process.stdout.write(`  ${fixture.name.padEnd(15)} ${scenario.name.padEnd(25)} ... `);
    const out = spawnSync('node', [BENCH, '--fixture', fixture.name, '--scenario', scenario.name], {
      encoding: 'utf-8',
      timeout: 120000,
    });

    if (out.status !== 0) {
      process.stdout.write(`FAIL (exit ${out.status})\n`);
      console.log(`    stderr: ${out.stderr.split('\n').slice(0, 3).join(' | ')}`);
      results.baseline_runs.push({
        fixture: fixture.name,
        scenario: scenario.name,
        error: out.stderr,
        status: out.status,
      });
      continue;
    }

    try {
      const parsed = JSON.parse(out.stdout);
      process.stdout.write(`${parsed.stats.median_ms.toString().padStart(6)} ms (median)\n`);
      results.baseline_runs.push(parsed);
    } catch (e) {
      process.stdout.write(`PARSE ERROR\n`);
      results.baseline_runs.push({ fixture: fixture.name, scenario: scenario.name, parseError: e.message, rawStdout: out.stdout.slice(0, 500) });
    }
  }
}

const outFile = join(__dirname, `baseline-${results.timestamp.replace(/:/g, '-').replace(/\..*$/, '')}.json`);
writeFileSync(outFile, JSON.stringify(results, null, 2));

console.log(`\n═══ Baseline saved to ${outFile.replace(process.cwd() + '\\', '')} ═══\n`);

// ── Summary table ──
console.log('Summary (median ms per fixture × scenario):\n');
const fixtures = corpus.fixtures.map(f => f.name);
const scenarios = corpus.scenarios.map(s => s.name);

const col1Width = Math.max(15, ...scenarios.map(s => s.length));
const colWidth = Math.max(10, ...fixtures.map(f => f.length));

let header = ''.padEnd(col1Width) + '  ';
for (const f of fixtures) header += f.padStart(colWidth) + '  ';
console.log(header);
console.log('─'.repeat(header.length));

for (const sc of scenarios) {
  let row = sc.padEnd(col1Width) + '  ';
  for (const fx of fixtures) {
    const r = results.baseline_runs.find(r => r.fixture === fx && r.scenario === sc);
    const v = r?.stats?.median_ms != null ? r.stats.median_ms.toString() : 'fail';
    row += v.padStart(colWidth) + '  ';
  }
  console.log(row);
}

console.log('\nGebruik deze cijfers als referentie voor elke PoC `results.md`.');

function getCurrentGitSha() {
  const out = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' });
  return out.status === 0 ? out.stdout.trim() : 'unknown';
}
