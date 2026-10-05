import { coreTests } from './tests/core.jsx'
import { eventTests } from './tests/events.jsx'
import { compositionTests } from './tests/composition.jsx'
import { featureTests } from './tests/features.jsx'
import { utilityTests } from './tests/utilities.jsx'
import { renderingTests } from './tests/rendering.jsx'
import { slotTests } from './tests/slots.jsx'
import { commandTests } from './tests/commands.jsx'
import { effectShorthandTests } from './tests/effect-shorthand.jsx'
import { testingUtilityTests } from './tests/testing-utility.jsx'
import { ssrHydrationTests } from './tests/ssr-hydration.jsx'
import { disposalTests } from './tests/disposal.jsx'
import { diagnosticsTests } from './tests/diagnostics.jsx'
import { bugfixTests } from './tests/bugfixes.jsx'
import { bugfixTests1G } from './tests/bugfixes-1g.jsx'
import { bugfixTests1H } from './tests/bugfixes-1h.jsx'
import { reviewTests2E2 } from './tests/review-2e2.jsx'
import { apiFixTests3D } from './tests/api-fixes-3d.jsx'
import { renderingTests1A } from './tests/rendering-1a.jsx'
import { fetchDriverTestsE2 } from './tests/fetch-driver-e2.jsx'
import { socketDriverTests2A } from './tests/socket-driver-2a.jsx'
import { routerTests5_4b } from './tests/router-5-4b.jsx'
import { domIsolationTests } from './tests/dom-isolation-6-0.jsx'
import { controlsTests } from './tests/controls-ct1.jsx'
import { nonBubblingTests1F } from './tests/nonbubbling-1f.jsx'
import { elementTestsP2b } from './tests/element-p2b.jsx'
import { elementCommandTests3A } from './tests/element-commands-3a.jsx'
import { timerFrameTests3K } from './tests/timers-frame-3k.jsx'
import { persistTests3B } from './tests/persist-3b.jsx'
import { viewTransitionTestsP1b } from './tests/view-transitions-p1b.jsx'
import { g213Tests } from './tests/g213-collection-move.jsx'
import { delegatorLeakTestsP45A } from './tests/delegator-leak-p45a.jsx'
import { schedulerTestsP45C } from './tests/scheduler-p45c.jsx'
import { lazyTeardownTestsP45D } from './tests/lazy-teardown-p45d.jsx'
import { reviewFixesTestsP45R } from './tests/review-fixes-p45r.jsx'
import { foundationsTestsP5_1F } from './tests/foundations-p5-1f.jsx'
import { widgetTestsP5W1 } from './tests/widget-p5w1.jsx'
import { webAwesomeTestsP5W3 } from './tests/webawesome-p5w3.jsx'
import { formTestsP5F1 } from './tests/forms-p5f1.jsx'
import { browserSourceTestsP5_2B } from './tests/browser-sources-p5-2b.jsx'
import { fixesTestsP5_1S } from './tests/fixes-p5-1s.jsx'
import { virtualTestsP5V1 } from './tests/virtual-p5v1.jsx'
import { uiTestsP5U } from './tests/ui-p5u.jsx'
import { collectionViewTransitionTestsP5_2A } from './tests/collection-vt-p5-2a.jsx'
import { getResults } from './harness.js'

async function runAll() {
  // BROWSER_TESTS_ONLY=<substring> (run-headless.mjs → ?only=): only the suites whose function
  // name contains it, case-insensitive (the dev server keeps the names)
  const only = new URLSearchParams(location.search).get('only')
  const suites = [
    coreTests,
    eventTests,
    compositionTests,
    featureTests,
    utilityTests,
    renderingTests,
    slotTests,
    commandTests,
    effectShorthandTests,
    testingUtilityTests,
    ssrHydrationTests,
    disposalTests,
    diagnosticsTests,
    bugfixTests,
    bugfixTests1G,
    bugfixTests1H,
    reviewTests2E2,
    apiFixTests3D,
    renderingTests1A,
    fetchDriverTestsE2,
    socketDriverTests2A,
    routerTests5_4b,
    domIsolationTests,
    controlsTests,
    nonBubblingTests1F,
    elementTestsP2b,
    elementCommandTests3A,
    timerFrameTests3K,
    persistTests3B,
    viewTransitionTestsP1b,
    g213Tests,
    delegatorLeakTestsP45A,
    schedulerTestsP45C,
    lazyTeardownTestsP45D,
    reviewFixesTestsP45R,
    foundationsTestsP5_1F,
    widgetTestsP5W1,
    webAwesomeTestsP5W3,
    formTestsP5F1,
    browserSourceTestsP5_2B,
    fixesTestsP5_1S,
    virtualTestsP5V1,
    uiTestsP5U,
    collectionViewTransitionTestsP5_2A,
  ]
  for (const suite of suites) if (!only || suite.name.toLowerCase().includes(only.toLowerCase())) await suite()

  const results = getResults()
  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length

  // Signal completion for headless runner
  window.__browserTestsDone = true
  window.__browserTestsPassed = passed
  window.__browserTestsFailed = failed
  window.__browserTestsResults = results
}

runAll().catch(err => {
  console.error('Test runner failed:', err)
  document.getElementById('summary').textContent = `Test runner error: ${err.message}`
  window.__browserTestsDone = true
  window.__browserTestsFailed = 1
  window.__browserTestsError = err.message
})
