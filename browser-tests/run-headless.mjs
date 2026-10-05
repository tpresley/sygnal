/**
 * Headless browser test runner using Playwright.
 * Starts a Vite dev server, opens the test page in headless Chromium,
 * waits for tests to complete, and exits with appropriate code.
 */

import { createServer as createNetServer } from 'node:net';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const NEXT = process.env.SYGNAL_CORE === 'next';
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
    match: [/\[Sygnal SYG406\] Broken: View threw/, /no handler/] },
  { test: 'features > Reducer error preserves previous state',
    match: [/\[Sygnal SYG216\] App: Reducer for 'BAD' threw/, /reducer crash/] },
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
    browser = await chromium.launch({ headless: true });
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

    // PLAN-4.6 R1-R4 (deleted at R5): SYGNAL_CORE=next runs the suite on the next component core
    // (run()'s internal flag, set before the app's modules load)
    if (NEXT) await page.addInitScript(() => { globalThis.__SYGNAL_CORE__ = 'next'; });

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

    console.log(`\nBrowser Tests${NEXT ? ' (next core)' : ''}: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

    if (NEXT) {
      // per test file (category): the R2-R4 phases bring the rest
      const by = new Map();
      for (const t of tests) {
        const c = by.get(t.category) || { pass: 0, fail: 0 };
        c[t.status === 'pass' ? 'pass' : 'fail']++;
        by.set(t.category, c);
      }
      for (const [c, n] of by) console.log(`  ${n.fail ? 'FAIL' : 'ok  '} ${c}: ${n.pass} passed, ${n.fail} failed`);
      console.log('');
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
