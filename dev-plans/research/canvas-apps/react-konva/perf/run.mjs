#!/usr/bin/env node
// Canvas benchmark: Playwright + Chromium, fixed viewport, real (CDP) input.
// Drives any app that exposes window.__canvasBench (see README, "Benchmark contract"),
// so the same script measures the Sygnal app with --url.
//
//   node perf/run.mjs                      # serves ./dist with `vite preview` (run `npm run build` first)
//   node perf/run.mjs --url http://localhost:5173/
//   node perf/run.mjs --help
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string' },
    sizes: { type: 'string', default: '1000,5000,10000' },
    selections: { type: 'string', default: '1,100,all' },
    steps: { type: 'string', default: '120' },
    warmup: { type: 'string', default: '10' },
    'startup-runs': { type: 'string', default: '5' },
    viewport: { type: 'string', default: '1440x900' },
    dpr: { type: 'string', default: '1' },
    cpu: { type: 'string', default: '1' },
    only: { type: 'string', default: 'startup,drag,pan,zoom,heap' },
    out: { type: 'string', default: path.join(root, 'perf', 'results') },
    executable: { type: 'string', default: process.env.CHROMIUM_PATH },
    headed: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opt.help) {
  console.log(`Usage: node perf/run.mjs [options]

  --url <url>            App to measure (default: start \`vite preview\` on ./dist)
  --sizes <list>         Shape counts (default 1000,5000,10000)
  --selections <list>    Drag selection sizes, numbers or "all" (default 1,100,all)
  --steps <n>            Measured pointer/wheel steps per scenario (default 120)
  --warmup <n>           Unmeasured steps before each scenario (default 10)
  --startup-runs <n>     Fresh page loads for startup time (default 5)
  --viewport <WxH>       Fixed viewport (default 1440x900)
  --dpr <n>              deviceScaleFactor (default 1)
  --cpu <n>              CDP CPU throttling rate, 1 = none (default 1)
  --only <list>          Subset of startup,drag,pan,zoom,heap
  --out <dir>            Where the JSON report goes (default perf/results)
  --executable <path>    Chromium binary (or CHROMIUM_PATH); default: Playwright's
  --headed               Show the browser`);
  process.exit(0);
}

const sizes = opt.sizes.split(',').map(Number);
const selections = opt.selections.split(',').map((s) => (s === 'all' ? 'all' : Number(s)));
const STEPS = Number(opt.steps);
const WARMUP = Number(opt.warmup);
const [VW, VH] = opt.viewport.split('x').map(Number);
const only = new Set(opt.only.split(','));

// ---- server ----------------------------------------------------------------------------

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function waitFor(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server at ${url} did not come up`);
}

let server;
let url = opt.url;
if (!url) {
  if (!existsSync(path.join(root, 'dist', 'index.html'))) {
    console.error('No ./dist: run `npm run build` first (or `npm run perf`), or pass --url.');
    process.exit(1);
  }
  const port = await freePort();
  server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: root, stdio: 'ignore' });
  url = `http://127.0.0.1:${port}/`;
  await waitFor(url);
}
const cleanup = () => server?.kill();
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// ---- browser ---------------------------------------------------------------------------

const { chromium } = await import('playwright');
// Headless Chromium runs frames at 60 Hz whatever the flags (--disable-frame-rate-limit
// and --disable-gpu-vsync change nothing there), and an input event is acknowledged
// on the next frame. So wall time per step is quantized to ~16.7 ms; the primary
// metric is the renderer main thread's busy time per step instead (see timeSteps).
const browser = await chromium.launch({ headless: !opt.headed, executablePath: opt.executable });

async function newPage() {
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: Number(opt.dpr) });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (Number(opt.cpu) > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(opt.cpu) });
  await cdp.send('Performance.enable');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, cdp, errors };
}

async function openApp(page) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__canvasBench, null, { timeout: 30000 });
  await page.evaluate(() => {
    // settle = everything the last input caused has been drawn: two frames and the
    // tasks between them (React schedules renders as tasks, Konva draws in rAF).
    const task = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    window.__perfSettle = async () => { await raf(); await task(); await raf(); await task(); };
  });
}

async function heapMB(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { usedMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), totalMB: +(m.JSHeapTotalSize / 1048576).toFixed(1), nodes: m.Nodes };
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const r = (v) => +v.toFixed(2);
  return { n: s.length, median: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1]), mean: r(mean) };
}

const taskSeconds = async (cdp) =>
  (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;

/**
 * Runs `count` steps of input + settle after `warmup` unmeasured ones. Per step:
 *  - busy: renderer main-thread task time (CDP TaskDuration delta): event handlers,
 *    framework work, canvas drawing, style/layout. This is the frame cost.
 *  - wall: input sent until settled, in 16.7 ms frames; > 2 frames means jank.
 */
async function timeSteps(page, cdp, count, warmup, doStep) {
  const busy = [];
  const wall = [];
  for (let i = 0; i < warmup + count; i++) {
    const b0 = await taskSeconds(cdp);
    const t0 = performance.now();
    await doStep(i);
    await page.evaluate(() => window.__perfSettle());
    const t1 = performance.now();
    const b1 = await taskSeconds(cdp);
    if (i >= warmup) { busy.push((b1 - b0) * 1000); wall.push(t1 - t0); }
  }
  return { busy: stats(busy), wall: stats(wall) };
}

// a wandering path within ±160×110 px of the start, so snapping engages and releases
const pathAt = (i) => ({ x: 160 * Math.sin((2 * Math.PI * i) / 60), y: 110 * Math.sin((2 * Math.PI * i) / 45) });

const report = {
  date: new Date().toISOString(),
  url,
  machine: { platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30) },
  browser: `Chromium ${browser.version()}`,
  settings: { viewport: `${VW}x${VH}`, dpr: Number(opt.dpr), cpuThrottle: Number(opt.cpu), steps: STEPS, warmup: WARMUP },
  framework: null,
  overheadMs: null,
  startup: null,
  heap: [],
  generate: [],
  drag: [],
  pan: [],
  zoom: [],
  errors: [],
};
const log = (...a) => console.log(...a);
const fmt = (s) => `busy median ${s.busy.median} ms, p95 ${s.busy.p95}, max ${s.busy.max} | wall median ${s.wall.median}, p95 ${s.wall.p95}`;

// ---- startup ---------------------------------------------------------------------------

if (only.has('startup')) {
  const runs = [];
  for (let i = 0; i < Number(opt['startup-runs']); i++) {
    const { context, page } = await newPage();
    await openApp(page);
    runs.push(await page.evaluate(async () => {
      await window.__canvasBench.frame();
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return { readyMs: performance.now(), domContentLoadedMs: nav?.domContentLoadedEventEnd, fcpMs: fcp?.startTime ?? null };
    }));
    await context.close();
  }
  const pick = (k) => stats(runs.map((r) => r[k]).filter((v) => v != null));
  report.startup = { readyMs: pick('readyMs'), domContentLoadedMs: pick('domContentLoadedMs'), fcpMs: pick('fcpMs') };
  log(`startup: ready median ${report.startup.readyMs.median} ms (FCP ${report.startup.fcpMs.median} ms) over ${runs.length} loads`);
}

// ---- per size ----------------------------------------------------------------------------

const { page, cdp, errors } = await newPage();
await openApp(page);
report.framework = await page.evaluate(() => window.__canvasBench.framework ?? 'unknown');
const center = await page.evaluate(() => window.__canvasBench.canvasCenter());

// cost of the measuring loop itself: hover moves over the canvas, no gesture
report.overheadMs = await timeSteps(page, cdp, STEPS, WARMUP, (i) =>
  page.mouse.move(center.x + (i % 2 ? 1 : -1), center.y));
log(`measuring overhead (hover step): busy median ${report.overheadMs.busy.median} ms, wall median ${report.overheadMs.wall.median} ms`);

if (only.has('heap')) report.heap.push({ shapes: 'initial', ...(await heapMB(cdp)) });

for (const n of sizes) {
  const genMs = await page.evaluate(async (n) => {
    const t = performance.now();
    await window.__canvasBench.generate(n);
    await window.__perfSettle();
    return performance.now() - t;
  }, n);
  const count = await page.evaluate(() => window.__canvasBench.count());
  report.generate.push({ shapes: n, count, ms: +genMs.toFixed(1) });
  log(`\n${n} shapes: generated + painted in ${genMs.toFixed(0)} ms`);
  if (only.has('heap')) {
    const h = await heapMB(cdp);
    report.heap.push({ shapes: n, ...h });
    log(`  heap ${h.usedMB} MB used`);
  }

  if (only.has('drag')) {
    for (const sel of selections) {
      await page.evaluate((s) => window.__canvasBench.select(s), sel);
      const start = await page.evaluate(() => window.__canvasBench.dragPoint());
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      // cross the drag threshold before measuring
      await page.mouse.move(start.x + 6, start.y + 6);
      await page.evaluate(() => window.__perfSettle());
      const s = await timeSteps(page, cdp, STEPS, WARMUP, (i) => {
        const d = pathAt(i + 1);
        return page.mouse.move(start.x + d.x, start.y + d.y);
      });
      const tUp = performance.now();
      await page.mouse.up();
      await page.evaluate(() => window.__perfSettle());
      const dropMs = performance.now() - tUp;
      report.drag.push({ shapes: n, selection: sel, ...s, dropMs: +dropMs.toFixed(1) });
      log(`  drag ${String(sel).padStart(5)}: ${fmt(s)}; drop ${dropMs.toFixed(0)} ms`);
      // put the document back for the next scenario
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await page.evaluate(() => window.__perfSettle());
    }
    await page.evaluate(() => window.__canvasBench.select(0));
  }

  if (only.has('pan')) {
    await page.mouse.move(center.x, center.y);
    const s = await timeSteps(page, cdp, STEPS, WARMUP, (i) =>
      page.mouse.wheel(i % 40 < 20 ? 24 : -24, i % 30 < 15 ? 18 : -18));
    report.pan.push({ shapes: n, ...s });
    log(`  pan       : ${fmt(s)}`);
  }

  if (only.has('zoom')) {
    await page.mouse.move(center.x + 37, center.y - 23);
    await page.keyboard.down('Control');
    // in 20 steps, out 20 steps: the camera returns to where it started
    const s = await timeSteps(page, cdp, STEPS, WARMUP, (i) => page.mouse.wheel(0, Math.floor(i / 20) % 2 ? 20 : -20));
    await page.keyboard.up('Control');
    report.zoom.push({ shapes: n, ...s });
    log(`  zoom      : ${fmt(s)}`);
  }
}

report.errors = errors;
await browser.close();
cleanup();

// ---- output ----------------------------------------------------------------------------

mkdirSync(opt.out, { recursive: true });
const file = path.join(opt.out, `${report.framework}-${report.date.replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(report, null, 2) + '\n');

const md = [];
const o = report.overheadMs;
md.push(`### ${report.framework} — ${report.browser}, ${report.settings.viewport} @${report.settings.dpr}x, ${report.machine.cpu} (${report.machine.cores} cores)`);
md.push('', `Per input step. **busy** = renderer main-thread time (handlers, framework, canvas draw); **wall** = input sent until two frames drawn (60 Hz, so multiples of ~16.7 ms). Loop overhead (hover step): busy ${o.busy.median} ms, wall ${o.wall.median} ms.`);
if (report.drag.length) {
  md.push('', '| shapes | dragged | busy median | busy p95 | busy max | wall median | wall p95 | drop |', '|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const d of report.drag) md.push(`| ${d.shapes} | ${d.selection} | ${d.busy.median} | ${d.busy.p95} | ${d.busy.max} | ${d.wall.median} | ${d.wall.p95} | ${d.dropMs} |`);
}
if (report.pan.length || report.zoom.length) {
  md.push('', '| shapes | pan busy median | pan busy p95 | pan wall median | zoom busy median | zoom busy p95 | zoom wall median |', '|---:|---:|---:|---:|---:|---:|---:|');
  for (const p of report.pan) {
    const z = report.zoom.find((x) => x.shapes === p.shapes);
    md.push(`| ${p.shapes} | ${p.busy.median} | ${p.busy.p95} | ${p.wall.median} | ${z?.busy.median ?? ''} | ${z?.busy.p95 ?? ''} | ${z?.wall.median ?? ''} |`);
  }
}
if (report.startup) md.push('', `Startup (bench ready + first frame): median ${report.startup.readyMs.median} ms, FCP ${report.startup.fcpMs.median} ms.`);
if (report.heap.length) md.push('', `JS heap after GC: ${report.heap.map((h) => `${h.shapes}: ${h.usedMB} MB`).join(', ')}.`);
if (report.generate.length) md.push('', `Generate + paint: ${report.generate.map((g) => `${g.shapes}: ${g.ms} ms`).join(', ')}.`);
if (errors.length) md.push('', `Page errors: ${errors.length} (see JSON).`);
writeFileSync(file.replace(/\.json$/, '.md'), md.join('\n') + '\n');
console.log('\n' + md.join('\n'));
console.log(`\nwrote ${path.relative(process.cwd(), file)}`);
