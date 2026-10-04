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
import { viewTransitionTestsP1b } from './tests/view-transitions-p1b.jsx'
import { g213Tests } from './tests/g213-collection-move.jsx'
import { getResults } from './harness.js'

async function runAll() {
  await coreTests()
  await eventTests()
  await compositionTests()
  await featureTests()
  await utilityTests()
  await renderingTests()
  await slotTests()
  await commandTests()
  await effectShorthandTests()
  await testingUtilityTests()
  await ssrHydrationTests()
  await disposalTests()
  await diagnosticsTests()
  await bugfixTests()
  await bugfixTests1G()
  await bugfixTests1H()
  await reviewTests2E2()
  await apiFixTests3D()
  await renderingTests1A()
  await fetchDriverTestsE2()
  await socketDriverTests2A()
  await routerTests5_4b()
  await domIsolationTests()
  await controlsTests()
  await nonBubblingTests1F()
  await elementTestsP2b()
  await elementCommandTests3A()
  await timerFrameTests3K()
  await viewTransitionTestsP1b()
  await g213Tests()

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
