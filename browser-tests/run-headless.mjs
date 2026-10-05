/**
 * Headless browser test runner using Playwright.
 * Starts a Vite dev server, opens the test page in headless Chromium,
 * waits for tests to complete, and exits with appropriate code.
 * BROWSER=firefox|webkit runs the suite in another engine (opt-in; the gate uses Chromium).
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
    const page = await browser.newPage();

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
    // PLAN-5 0-S6 (D199, adopted): real pointer/keyboard input for the web-component tests.
    // Playwright's CSS locators pierce open shadow roots ('#test-3 .email input' is wa-input's inner <input>).
    await page.exposeFunction('__pw', async (action, selector, arg) => {
      const loc = selector && page.locator(selector);
      const timeout = 4000; // fail inside the test's own time limit, with Playwright's reason
      switch (action) {
        case 'click': return void await loc.click({ timeout, ...arg });
        case 'hover': return void await loc.hover({ timeout, ...arg });
        case 'focus': return void await loc.focus({ timeout });
        case 'press': return void await loc.press(arg, { timeout });
        case 'fill': return void await loc.fill(arg, { timeout });
        case 'type': return void await loc.pressSequentially(arg, { timeout });
        case 'mouse-away': return void await page.mouse.move(0, 0);
        case 'role': return loc.getByRole(arg.role, { name: arg.name, exact: true }).count();
        case 'aria': return loc.ariaSnapshot();
        default: throw new Error(`__pw: unknown action '${action}'`);
      }
    });

    await page.goto(url);

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

    console.log(`\nBrowser Tests (${ENGINE} ${browser.version()}): ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

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
