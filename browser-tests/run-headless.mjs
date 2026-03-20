/**
 * Headless browser test runner using Playwright.
 * Starts a Vite dev server, opens the test page in headless Chromium,
 * waits for tests to complete, and exits with appropriate code.
 */

import { createServer } from 'vite';
import { chromium } from 'playwright';

const PORT = 5299;
const TIMEOUT = 30000;

async function run() {
  // Start Vite dev server
  const server = await createServer({
    root: new URL('.', import.meta.url).pathname,
    server: { port: PORT, strictPort: true },
    logLevel: 'silent',
  });
  await server.listen();

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Collect console messages for debugging failures
    const consoleMsgs = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('Error in view') && !msg.text().includes('Error in model') && !msg.text().includes('Error instantiating')) {
        consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto(`http://localhost:${PORT}/`);

    // Wait for tests to complete
    const done = await page.waitForFunction(
      () => window.__browserTestsDone === true,
      { timeout: TIMEOUT }
    ).catch(() => null);

    if (!done) {
      console.error('Browser tests timed out after', TIMEOUT, 'ms');
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

    console.log(`\nBrowser Tests: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

    if (failed > 0) {
      const failures = tests.filter(t => t.status === 'fail');
      for (const f of failures) {
        console.error(`  FAIL: ${f.name} — ${f.details}`);
      }
      console.log('');
    }

    if (consoleMsgs.length > 0) {
      console.log('Unexpected console errors:');
      consoleMsgs.forEach(m => console.log(`  ${m}`));
    }

    process.exit(failed > 0 ? 1 : 0);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

run().catch(err => {
  console.error('Headless runner failed:', err.message);
  process.exit(1);
});
