/**
 * Headless browser test runner using Playwright.
 * Starts a Vite dev server, opens the test page in headless Chromium,
 * waits for tests to complete, and exits with appropriate code.
 * BROWSER=firefox|webkit runs the suite in another engine (opt-in; the gate uses Chromium).
 * BROWSER_TESTS_ONLY=<substring> runs only the matching suites. Tests get real input through
 * window.__pwType (typing), window.__pw (locator actions) and window.__pwInput (mouse, keys,
 * Chromium touch).
 * PLAN-6 2-W (D267, G-599): after the suite, the WebMCP round trip runs on its own page
 * (webmcp.html): natively in this Chromium (--enable-features=WebMCP), and through
 * @mcp-b/webmcp-polyfill in a second Chromium launch without the switch, in Firefox and in WebKit
 * (plus a no-WebMCP page). BROWSER_TESTS_ONLY=webmcp runs only that; BROWSER_TESTS_WEBMCP=0 skips it.
 */

import { createServer as createNetServer } from 'node:net';
import { createServer } from 'vite';
import * as playwright from 'playwright';
import { consoleAllowlist } from './console-allowlist.mjs';

const ENGINE = process.env.BROWSER || 'chromium';
if (!['chromium', 'firefox', 'webkit'].includes(ENGINE)) {
  console.error(`BROWSER must be chromium, firefox or webkit (got '${ENGINE}')`);
  process.exit(1);
}

const HOST = '127.0.0.1';

// the full suite took ~27 s at PLAN-4 1-F and ~85–95 s at 6.1.0 (375 tests + the WebMCP pages);
// the default is about twice that. BROWSER_TESTS_TIMEOUT_MS raises it on a loaded machine (PLAN-6 G-583)
const TIMEOUT = Number(process.env.BROWSER_TESTS_TIMEOUT_MS) || 180000;

// Launch args (PLAN-6 G-583, D267): Chromium runs with WebMCP on (`--enable-features=WebMCP`, the
// switch behind chrome://flags/#enable-webmcp-testing; Chrome 153 = chromium-1243). BROWSER_ARGS
// (space-separated) adds more; BROWSER_ARGS_DEFAULTS=0 drops the defaults.
const DEFAULT_ARGS = { chromium: ['--enable-features=WebMCP'], firefox: [], webkit: [] };
const LAUNCH_ARGS = [
  ...(process.env.BROWSER_ARGS_DEFAULTS === '0' ? [] : DEFAULT_ARGS[ENGINE]),
  ...(process.env.BROWSER_ARGS || '').split(/\s+/).filter(Boolean),
];

/**
 * Console errors the error-path tests provoke on purpose (G-076). Each entry
 * names the test that causes it (`test`: its runTest name, exactly); a message
 * must arrive while that test runs (G-503: the harness reports each test's start
 * through window.__pwTest; G-528: and its end, so nothing between tests matches)
 * and match every regex of the entry. These are counted
 * and summarised, not printed. Any other console error (or uncaught page error)
 * fails the run, so new errors can't hide among them.
 */
const EXPECTED_CONSOLE_ERRORS = [
  { test: 'isolatedState: throws without flag',
    match: [/\[Sygnal SYG405\] Bad: .*Sub-component threw/] },
  { test: 'Error without onError renders data-sygnal-error',
    match: [/\[Sygnal SYG406\] Broken: View threw/, /no handler|\bError\b/] },  // Firefox prints the attached Error as just 'Error'
  { test: 'Reducer error preserves previous state',
    match: [/\[Sygnal SYG216\] App: Reducer for 'BAD' threw/, /reducer crash|\bError\b/] },
  // PLAN-5 3-I G-460: the transition SYG149 warns of (Chromium logs the duplicate name)
  { test: 'G-460: SYG149 ignores a list in a display: none panel, and reports it once the panel is shown',
    match: [/Unexpected duplicate view-transition-name: p53i-/] },
  // PLAN-5 3-N G-489: the skipped transition (no unhandled rejection; Chromium logs the name)
  { test: 'G-489: a View Transition skipped for duplicate names leaves no unhandled rejection',
    match: [/Unexpected duplicate view-transition-name: p53n-/] },
];

/** G-503: the runTest name of the test running (G-528: null between tests) */
const allowlist = consoleAllowlist(EXPECTED_CONSOLE_ERRORS);

/**
 * Ask the OS for a free port. Vite treats `port: 0` as "use the default
 * port" (5173), so it can't hand out an ephemeral port itself. A fixed port
 * would keep parallel worktrees from running browser tests at the same time
 * (G-034); BROWSER_TESTS_PORT pins one if needed.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function run() {
  // Start Vite dev server
  const fixedPort = Number(process.env.BROWSER_TESTS_PORT) || 0;
  const server = await createServer({
    root: new URL('.', import.meta.url).pathname,
    // Without a fixed port, a port grabbed by another process between
    // freePort() and listen() makes Vite try the next one (strictPort off);
    // the URL below is read from the address the server actually bound.
    server: { host: HOST, port: fixedPort || await freePort(), strictPort: !!fixedPort },
    logLevel: 'silent',
  });
  await server.listen();
  const { port } = server.httpServer.address();
  const url = `http://${HOST}:${port}/`;

  let browser;
  try {
    browser = await playwright[ENGINE].launch({ headless: true, args: LAUNCH_ARGS });
    // (a context of its own: browser.newPage()'s can't open the second page __pwBrowser('otherTab') needs)
    const page = await (await browser.newContext()).newPage();

    // Console errors: expected ones (EXPECTED_CONSOLE_ERRORS) are counted,
    // anything else fails the run.
    const consoleMsgs = [];
    const expectedSeen = new Map();
    page.on('console', msg => {
      // PLAN-6: measurements a suite prints for the report ('[p6-…] {...}')
      if (msg.type() === 'log' && msg.text().startsWith('[p6-')) console.log(`${ENGINE} ${msg.text()}`);
      if (msg.type() !== 'error') return;
      const text = msg.text();
      const entry = allowlist.expected(text);
      if (entry) expectedSeen.set(entry, (expectedSeen.get(entry) || 0) + 1);
      else consoleMsgs.push(`[console.error] ${text}`);
    });
    page.on('pageerror', err => {
      consoleMsgs.push(`[uncaught] ${err.stack || err.message}`);
    });

    // G-503: the harness names each test as it starts (the console allowlist is per test);
    // G-528: null when it ends
    await page.exposeFunction('__pwTest', (name) => { allowlist.start(name); });

    // G-146: real keyboard input for the tests (typed by Playwright at full speed)
    await page.exposeFunction('__pwType', (selector, text, delay) =>
      page.locator(selector).pressSequentially(text, { delay }));
    // D199 (spike 0-S6): real pointer/keyboard input on an element, through Playwright's locator
    // (CSS selectors pierce open shadow roots). `await window.__pw('click', '#test-3 .save')`.
    // Fails within 4 s (inside a test's own limit) with Playwright's reason.
    let cdp = null; // a CDP session (Chromium): touch input, the accessibility tree
    await page.exposeFunction('__pw', async (action, selector, arg) => {
      const loc = selector && page.locator(selector);
      const timeout = 4000;
      switch (action) {
        case 'click': return void await loc.click({ timeout, ...arg });
        case 'hover': return void await loc.hover({ timeout, ...arg });
        case 'focus': return void await loc.focus({ timeout });
        case 'press': return void await loc.press(arg, { timeout });
        case 'fill': return void await loc.fill(arg, { timeout });
        case 'type': return void await loc.pressSequentially(arg, { timeout });
        case 'mouse-away': return void await page.mouse.move(0, 0);
        // PLAN-5 2-U: other getByRole options pass through (expanded, selected, includeHidden...)
        case 'role': { const { role, ...o } = arg; return loc.getByRole(role, { exact: true, ...o }).count(); }
        case 'aria': return loc.ariaSnapshot();
        // PLAN-5 2-U (from spikes 0-S3/0-S4): the engine's own accessibility tree (Chromium, CDP),
        // which Playwright's role queries don't consult (they ignore modal inertness): the node
        // with this role and name is 'exposed', 'ignored' or 'absent'; with `in`, the role of the
        // live region / container it must be inside; with `prop`, that property's value instead
        // ('expanded', 'description', ...). Other engines: null.
        case 'ax': {
          if (ENGINE !== 'chromium') return null;
          cdp ||= await page.context().newCDPSession(page);
          const { nodes } = await cdp.send('Accessibility.getFullAXTree');
          const byId = new Map(nodes.map(n => [n.nodeId, n]));
          const n = nodes.find(x => x.role?.value === arg.role && x.name?.value === arg.name);
          if (!n) return 'absent';
          if (arg.prop) return n[arg.prop]?.value ?? n.properties?.find(p => p.name === arg.prop)?.value?.value ?? null;
          if (n.ignored) return 'ignored';
          if (!arg.in) return 'exposed';
          for (let p = n; (p = byId.get(p.parentId));) if (p.role?.value === arg.in) return p.ignored ? 'ignored' : 'exposed';
          return 'outside ' + arg.in;
        }
        default: throw new Error(`__pw: unknown action '${action}'`);
      }
    });
    // D199 (spike 0-S5): a scripted sequence of trusted pointer/key input at page coordinates:
    // steps [['move', x, y, steps?] | ['down'] | ['up'] | ['key', name] | ['wait', ms] |
    // ['touchStart' | 'touchMove', x, y] | ['touchEnd']]. Touch goes through CDP
    // (Input.dispatchTouchEvent): Chromium only; elsewhere a touch step throws.
    await page.exposeFunction('__pwInput', async (steps) => {
      for (const [op, a, b, n] of steps) {
        if (op === 'move') await page.mouse.move(a, b, { steps: n || 1 });
        else if (op === 'down') await page.mouse.down();
        else if (op === 'up') await page.mouse.up();
        else if (op === 'key') await page.keyboard.press(a);
        else if (op === 'wait') await new Promise(r => setTimeout(r, a));
        else if (op === 'touchStart' || op === 'touchMove' || op === 'touchEnd') {
          if (ENGINE !== 'chromium') throw new Error(`__pwInput: touch input needs Chromium (CDP), not ${ENGINE}`);
          cdp ||= await page.context().newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: op, touchPoints: op === 'touchEnd' ? [] : [{ x: a, y: b }] });
        } else throw new Error(`__pwInput: unknown step '${op}'`);
      }
    });

    // PLAN-5 2-B: the browser context's state for the browser-source tests:
    // ['offline', bool] (setOffline), ['grant', [permission...]] (grantPermissions for the page's
    // origin; resolves to '' or the engine's refusal), ['clearPermissions'], ['emulateMedia',
    // { colorScheme }] (page.emulateMedia), ['geolocation',
    // { latitude, longitude, accuracy? }] (setGeolocation), ['otherTab', key, value] (a second page
    // of the same origin writes localStorage, null removes; the test page gets the `storage` event),
    // ['engine'] (the engine's name), ['reset'] (G-391: online, no permissions granted, the default
    // media emulation; main.js calls it after every suite, so a suite's changes don't reach the next)
    await page.exposeFunction('__pwBrowser', async (op, a, b) => {
      const ctx = page.context();
      if (op === 'engine') return ENGINE;
      if (op === 'reset') {
        await ctx.setOffline(false);
        await ctx.clearPermissions();
        // the context's defaults ('light', 'no-preference'; null would fall back to the OS's
        // setting, which WebKit follows: a dark-mode Mac stays dark)
        await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
        return;
      }
      if (op === 'offline') return void await ctx.setOffline(!!a);
      if (op === 'grant') return ctx.grantPermissions(a, { origin: new URL(url).origin }).then(() => '', e => e.message.split('\n')[0]);
      if (op === 'clearPermissions') return void await ctx.clearPermissions();
      if (op === 'geolocation') return void await ctx.setGeolocation(a);
      if (op === 'emulateMedia') return void await page.emulateMedia(a);
      if (op === 'otherTab') {
        const other = await ctx.newPage();
        try {
          await other.goto(`${url}g095-frame.html`);
          await other.evaluate(([k, v]) => v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v), [a, b]);
        } finally { await other.close(); }
        return;
      }
      throw new Error(`__pwBrowser: unknown op '${op}'`);
    });

    // D199 (spike 0-S6): BROWSER_TESTS_ONLY=<substring> runs only the suites whose function name
    // contains it, case-insensitive (main.js reads ?only=); 'webmcp': only the WebMCP page
    const only = process.env.BROWSER_TESTS_ONLY;
    const onlyWebMcp = only?.toLowerCase() === 'webmcp';
    const withWebMcp = process.env.BROWSER_TESTS_WEBMCP !== '0' && (!only || onlyWebMcp);
    if (onlyWebMcp) process.exit(await runWebMcp(browser, url) ? 1 : 0);
    await page.goto(only ? `${url}?only=${encodeURIComponent(only)}` : url);

    // Wait for tests to complete
    let waitError = null;
    const done = await page.waitForFunction(
      () => window.__browserTestsDone === true,
      undefined, // waitForFunction(fn, arg, options): the options are the third argument
      { timeout: TIMEOUT }
    ).catch((err) => { waitError = err; return null; });

    if (!done) {
      // a page crash or closed target also rejects the wait: say which, and show the page's console
      console.error(`Browser tests did not finish (limit ${TIMEOUT} ms)${waitError ? `: ${waitError.message.split('\n')[0]}` : ''}`);
      for (const m of consoleMsgs.slice(-20)) console.error('  ' + m);
      // where it stopped: the summary and the last rows the harness rendered (the hang is after them)
      const progress = await page.evaluate(() => ({
        summary: document.getElementById('summary')?.textContent,
        rows: [...document.querySelectorAll('#results-body tr')].slice(-5).map(tr => tr.textContent),
        fails: [...document.querySelectorAll('#results-body tr')]
          .filter(tr => tr.querySelector('td.fail')).map(tr => tr.textContent),
      })).catch(() => null);
      if (progress) {
        console.error(`  progress: ${progress.summary}`);
        for (const r of progress.fails) console.error(`  FAIL: ${r}`);
        for (const r of progress.rows) console.error(`  last: ${r}`);
      }
      process.exit(1);
    }

    const results = await page.evaluate(() => ({
      passed: window.__browserTestsPassed,
      failed: window.__browserTestsFailed,
      error: window.__browserTestsError,
      tests: window.__browserTestsResults,
    }));

    // Print results
    const { passed, failed, tests, error } = results;

    if (error) {
      console.error('Test runner error:', error);
      process.exit(1);
    }

    console.log(`\nBrowser Tests (${ENGINE} ${browser.version()}): ${passed} passed, ${failed} failed, ${passed + failed} total${only ? ` (BROWSER_TESTS_ONLY=${only})` : ''}\n`);
    if (only && passed + failed === 0) {
      console.error(`BROWSER_TESTS_ONLY=${only} matched no suite (main.js runs the suites whose function name contains it)`);
      process.exit(1);
    }

    if (failed > 0) {
      const failures = tests.filter(t => t.status === 'fail');
      for (const f of failures) {
        console.error(`  FAIL: ${f.name} — ${f.details}`);
      }
      console.log('');
    }

    const expectedCount = [...expectedSeen.values()].reduce((a, b) => a + b, 0);
    if (expectedCount > 0) {
      console.log(`${expectedCount} expected console error(s) from error-path tests (suppressed):`);
      for (const [entry, n] of expectedSeen) console.log(`  ok  ${entry.test}${n > 1 ? ` (x${n})` : ''}`);
      console.log('');
    }

    if (consoleMsgs.length > 0) {
      console.error(`FAIL: ${consoleMsgs.length} unexpected console error(s):`);
      consoleMsgs.forEach(m => console.error(`  ${m}`));
      console.error('If an error is intended, add it to EXPECTED_CONSOLE_ERRORS in run-headless.mjs.\n');
    }

    const webMcpFailed = withWebMcp ? await runWebMcp(browser, url) : 0;
    process.exit(failed > 0 || consoleMsgs.length > 0 || webMcpFailed ? 1 : 0);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

/**
 * PLAN-6 2-W: the WebMCP round trip (webmcp.html, src/webmcp/) per mode, each on a fresh page:
 * Chromium 'native' in this browser when it has the switch, then 'none' and 'polyfill' in a second
 * launch without it; Firefox / WebKit 'none' and 'polyfill' in this browser. Returns the number of
 * failed checks plus unexpected console errors (EXPECTED_CONSOLE_ERRORS applies per step, G-624).
 */
async function runWebMcp(browser, url) {
  const t0 = Date.now();
  const webmcpSwitch = a => /^--enable-(blink-)?features=.*WebMCP/.test(a);
  const runs = [];
  if (ENGINE === 'chromium') {
    if (LAUNCH_ARGS.some(webmcpSwitch)) runs.push([browser, 'native']);
    else console.log('WebMCP: Chromium launched without --enable-features=WebMCP: the native mode is skipped');
  }
  let second = null;
  if (ENGINE === 'chromium') {
    second = await playwright.chromium.launch({ headless: true, args: LAUNCH_ARGS.filter(a => !webmcpSwitch(a)) });
    runs.push([second, 'none'], [second, 'polyfill']);
  } else runs.push([browser, 'none'], [browser, 'polyfill']);
  let bad = 0;
  const lines = [], expectedSeen = new Map();
  try {
    for (const [b, mode] of runs) {
      const ctx = await b.newContext();
      const page = await ctx.newPage();
      const errors = [];
      // G-624: the same per-test console allowlist as the main suite (its entries name WebMCP
      // steps too); the page's step() reports each step's start and end through __pwTest
      const pageAllowlist = consoleAllowlist(EXPECTED_CONSOLE_ERRORS);
      await page.exposeFunction('__pwTest', (name) => { pageAllowlist.start(name); });
      page.on('console', m => {
        if (m.type() !== 'error') return;
        const text = m.text(), entry = pageAllowlist.expected(text);
        if (entry) expectedSeen.set(entry, (expectedSeen.get(entry) || 0) + 1);
        else errors.push(`[console.error] ${text}`);
      });
      page.on('pageerror', e => errors.push(`[uncaught] ${e.stack || e.message}`));
      // real input for the confirmation dialog
      await page.exposeFunction('__pwWebMcp', async (op, arg) => {
        if (op === 'press') return void await page.keyboard.press(arg);
        if (op === 'click') return void await page.getByRole('button', { name: arg, exact: true }).click({ timeout: 4000 });
        throw new Error(`__pwWebMcp: unknown op '${op}'`);
      });
      await page.goto(`${url}webmcp.html?mode=${mode}`);
      const done = await page.waitForFunction(() => window.__done === true, undefined, { timeout: 60000 }).catch(e => e);
      const results = done instanceof Error ? [{ name: 'page', pass: false, detail: done.message.split('\n')[0] }] : await page.evaluate(() => window.__results);
      const checks = results.filter(r => r.name !== 'env');
      const failed = checks.filter(r => !r.pass);
      bad += failed.length + errors.length;
      lines.push(`WebMCP (${ENGINE} ${b.version()}, ${mode}): ${checks.length - failed.length}/${checks.length} passed`);
      for (const f of failed) lines.push(`  FAIL: ${f.name} — ${f.detail}`);
      for (const e of errors) lines.push(`  FAIL: ${e}`);
      await ctx.close();
    }
  } finally {
    if (second) await second.close();
  }
  for (const [entry, n] of expectedSeen) lines.push(`  ok  expected console error: ${entry.test}${n > 1 ? ` (x${n})` : ''}`);
  console.log(lines.join('\n') + `\nWebMCP pages: ${Date.now() - t0} ms\n`);
  return bad;
}

run().catch(err => {
  console.error('Headless runner failed:', err.message);
  process.exit(1);
});
