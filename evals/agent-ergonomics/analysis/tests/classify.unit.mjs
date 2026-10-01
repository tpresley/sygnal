// node --test evals/agent-ergonomics/analysis/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { basePhase, verifyOutcome, errorSignature, normalizeSignature, isTestPath, bashWriteTargets, isRefused, uncataloguedCause, learnTopic, isVerifyCall } from '../lib/classify.mjs'
import { TRIAL, PASS_TESTS, PASS_BUILD, FAIL_B007, FAIL_TRUNC, GUARD } from './fixtures.mjs'

const c = (name, input) => ({ name, input })

test('basePhase: tools map to phases', () => {
  assert.equal(basePhase(c('Skill', { skill: 'sygnal-dev' })), 'learn')
  assert.equal(basePhase(c('Read', { file_path: `${TRIAL}/src/App.jsx` })), 'orient')
  assert.equal(basePhase(c('Read', { file_path: '/Users/x/.claude/skills/sygnal-dev/references/component-patterns.md' })), 'learn')
  assert.equal(basePhase(c('Read', { file_path: `${TRIAL}/node_modules/sygnal/src/extra/testing.ts` })), 'learn')
  assert.equal(basePhase(c('Write', { file_path: `${TRIAL}/src/App.jsx` })), 'implement')
  assert.equal(basePhase(c('Write', { file_path: `${TRIAL}/src/tmp-pin.test.jsx` })), 'test-authoring')
  assert.equal(basePhase(c('Edit', { file_path: `${TRIAL}/test/pin.js` })), 'test-authoring')
  assert.equal(basePhase(c('SubagentHandback', { message: 'done' })), 'report')
  assert.equal(basePhase(c('mcp__Claude_Browser__browser_batch', { actions: [] })), 'verify')
})

test('basePhase: Bash commands', () => {
  assert.equal(basePhase(c('Bash', { command: `npm --prefix ${TRIAL} test 2>&1 | tail -6` })), 'verify')
  assert.equal(basePhase(c('Bash', { command: `cd ${TRIAL} && npm run build` })), 'verify')
  assert.equal(basePhase(c('Bash', { command: `ls -a ${TRIAL}; cat ${TRIAL}/package.json` })), 'orient')
  assert.equal(basePhase(c('Bash', { command: `grep -n CHILD ${TRIAL}/node_modules/sygnal/dist/index.esm.js` })), 'learn')
  assert.equal(basePhase(c('Bash', { command: 'grep -n -A25 "## Context" /Users/x/.claude/skills/sygnal-dev/references/component-patterns.md' })), 'learn')
  assert.equal(basePhase(c('Bash', { command: `cat > ${TRIAL}/src/TaskItem.jsx <<'EOF'\nfunction T() {}\nEOF` })), 'implement')
  assert.equal(basePhase(c('Bash', { command: `cat > ${TRIAL}/src/pin.test.jsx <<'EOF'\nit()\nEOF` })), 'test-authoring')
  assert.equal(basePhase(c('Bash', { command: `rm ${TRIAL}/src/tmp-pin.test.jsx` })), 'test-authoring')
  assert.equal(basePhase(c('Bash', { command: `sed -i '' -e "s/a/b/" ${TRIAL}/src/App.jsx` })), 'implement')
})

test('isVerifyCall reuses the harness counter', () => {
  assert.ok(isVerifyCall(c('Bash', { command: `npm --prefix ${TRIAL} test` })))
  assert.ok(isVerifyCall(c('Bash', { command: 'npx vitest run' })))
  assert.ok(!isVerifyCall(c('Bash', { command: 'npm install' })))
  assert.ok(!isVerifyCall(c('Read', { file_path: 'x' })))
})

test('isTestPath and bashWriteTargets', () => {
  assert.ok(isTestPath('src/App.test.jsx'))
  assert.ok(isTestPath('/a/b/test/status.test.js'))
  assert.ok(isTestPath('/a/b/__tests__/x.js'))
  assert.ok(!isTestPath('/a/b/src/App.jsx'))
  assert.deepEqual(bashWriteTargets(`cat > ${TRIAL}/src/A.jsx <<'EOF'\nx\nEOF`), [`${TRIAL}/src/A.jsx`])
  assert.deepEqual(bashWriteTargets('npm test 2>&1 | tail -5'), [])
  // A script that only reads a file doesn't write it (fix2: writes are detected from open(p, 'w') etc.).
  assert.deepEqual(bashWriteTargets("python3 - <<'EOF'\np='src/App.jsx'; s=open(p).read()\nEOF"), [])
  assert.deepEqual(bashWriteTargets("python3 - <<'EOF'\np='src/App.jsx'; s=open(p).read()\nopen(p,'w').write(s)\nEOF"), ['src/App.jsx'])
})

test('verifyOutcome reads vitest/vite summaries before exit codes', () => {
  assert.equal(verifyOutcome({ text: PASS_TESTS, isError: false }), 'pass')
  assert.equal(verifyOutcome({ text: PASS_BUILD, isError: false }), 'pass')
  assert.equal(verifyOutcome({ text: 'No test files found, exiting with code 0', isError: false }), 'pass')
  assert.equal(verifyOutcome({ text: FAIL_B007, isError: false }), 'fail') // piped through tail: no exit code
  assert.equal(verifyOutcome({ text: FAIL_TRUNC, isError: false }), 'fail')
  assert.equal(verifyOutcome({ text: 'Error: Exit code 1\nsomething', isError: true }), 'fail')
  assert.equal(verifyOutcome({ text: GUARD, isError: true }), 'refused')
  assert.equal(verifyOutcome({ text: 'hello', isError: false }), 'unknown')
  assert.ok(isRefused({ text: GUARD, isError: true }))
  assert.ok(!isRefused({ text: GUARD, isError: false }))
})

test('errorSignature picks the first real error line and strips paths and positions', () => {
  assert.equal(errorSignature(FAIL_B007), 'ReferenceError: __sygnal is not defined')
  assert.equal(errorSignature(FAIL_TRUNC), 'Test Files 1 failed (1)')
  assert.equal(errorSignature('Error: waitForState timed out after 2000ms\n at x'), 'Error: waitForState timed out after Nms')
  assert.equal(normalizeSignature('Cannot find module /private/tmp/x/y/src/Foo.jsx:12:5'), 'Cannot find module Foo.jsx')
  assert.equal(uncataloguedCause('Test Files 1 failed (1)'), 'unknown (output truncated)')
  assert.equal(uncataloguedCause("AssertionError: expected '3 open' to be '2 open'"), 'agent-mistake')
  assert.equal(uncataloguedCause('weird'), 'other')
})

test('learnTopic', () => {
  assert.equal(learnTopic(c('Skill', { skill: 'sygnal-dev' })), 'skill-load')
  assert.equal(learnTopic(c('Read', { file_path: `${TRIAL}/node_modules/sygnal/src/extra/testing.ts` })), 'testing-utility')
  assert.equal(learnTopic(c('Bash', { command: `ls ${TRIAL}/node_modules/sygnal/dist/vite` })), 'vite-plugin')
  assert.equal(learnTopic(c('Bash', { command: 'grep -n -i -A30 "driverFromAsync" /x/skills/sygnal-dev/references/component-patterns.md' })), 'drivers')
  assert.equal(learnTopic(c('Bash', { command: `grep -n "CHILD" ${TRIAL}/node_modules/sygnal/dist/index.esm.js` })), 'parent-child-props')
  assert.equal(learnTopic(c('Read', { file_path: `${TRIAL}/node_modules/sygnal/README.md` })), 'framework-source')
})
