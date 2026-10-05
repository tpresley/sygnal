/**
 * Headless browser test runner using Playwright.
 * Starts a Vite dev server, opens the test page in headless Chromium,
 * waits for tests to complete, and exits with appropriate code.
 * BROWSER=firefox|webkit runs the suite in another engine (opt-in; the gate uses Chromium).
 * BROWSER_TESTS_ONLY=<substring> runs only the matching suites. Tests get real input through
 * window.__pwType (typing), window.__pw (locator actions) and window.__pwInput (mouse, keys,
 * Chromium touch).
 */

import { createServer as createNetServer } from 'node:net';
import { createServer } from 'vite';
import * as playwright from 'playwright';

const ENGINE = process.env.BROWSER || 'chromium';
if (!['chromium', 'firefox', 'webkit'].includes(ENGINE)) {
  console.error(`BROWSER must be chromium, firefox or webkit (got '${ENGINE}')`);
  process.exit(1);
}

const HOST = '127.0.0.1';

const TIMEOUT = 90000; // the full suite takes ~27 s (PLAN-4 1-F)

/**
 * Console errors the error-path tests provoke on purpose (G-076). Each entry
 * names the test that causes it; a message must match every regex of an entry.
 * These are counted and summarised, not printed. Any other console error (or
 * uncaught page error) fails the run, so new errors can't hide among them.
 */
const EXPECTED_CONSOLE_ERRORS = [
  { test: 'composition > isolatedState: throws without flag',
    match: [/\[Sygnal SYG405\] Bad: .*Sub-component threw/] },
  { test: 'features > Error without onError renders data-sygnal-error',
    match: [/\[Sygnal SYG406\] Broken: View threw/, /no handler|\bError\b/] },  // Firefox prints the attached Error as just 'Error'
  { test: 'features > Reducer error preserves previous state',
    match: [/\[Sygnal SYG216\] App: Reducer for 'BAD' threw/, /reducer crash|\bError\b/] },
];

function expectedEntry(text) {
  return EXPECTED_CONSOLE_ERRORS.find(e => e.match.every(re => re.test(text)));
}

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
    browser = await playwright[ENGINE].launch({ headless: true });
    // (a context of its own: browser.newPage()'s can't open the second page __pwBrowser('otherTab') needs)
    const page = await (await browser.newContext()).newPage();

    // Console errors: expected ones (EXPECTED_CONSOLE_ERRORS) are counted,
    // anything else fails the run.
    const consoleMsgs = [];
    const expectedSeen = new Map();
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      const entry = expectedEntry(text);
      if (entry) expectedSeen.set(entry, (expectedSeen.get(entry) || 0) + 1);
      else consoleMsgs.push(`[console.error] ${text}`);
    });
    page.on('pageerror', err => {
      consoleMsgs.push(`[uncaught] ${err.stack || err.message}`);
    });

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
    // ['engine'] (the engine's name)
    await page.exposeFunction('__pwBrowser', async (op, a, b) => {
      const ctx = page.context();
      if (op === 'engine') return ENGINE;
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
    // contains it, case-insensitive (main.js reads ?only=)
    const only = process.env.BROWSER_TESTS_ONLY;
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

    process.exit(failed > 0 || consoleMsgs.length > 0 ? 1 : 0);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

run().catch(err => {
  console.error('Headless runner failed:', err.message);
  process.exit(1);
});
