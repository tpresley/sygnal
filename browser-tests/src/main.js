import { coreTests } from './tests/core.jsx'
import { eventTests } from './tests/events.jsx'
import { compositionTests } from './tests/composition.jsx'
import { featureTests } from './tests/features.jsx'
import { utilityTests } from './tests/utilities.jsx'
import { renderingTests } from './tests/rendering.jsx'
import { slotTests } from './tests/slots.jsx'
import { commandTests } from './tests/commands.jsx'
import { effectShorthandTests } from './tests/effect-shorthand.jsx'
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
