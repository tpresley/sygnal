// Unit tests for the transcript classifiers. Run with:
//   node --test evals/agent-ergonomics/tests/transcript.unit.mjs
// (Named *.unit.mjs so the repo's root vitest run never collects it.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRunCommand, isEditCommand, mentionsHidden, splitCommands } from '../lib/transcript.mjs'

const T = '/private/tmp/x/scratchpad/evals/trials/baseline/sygnal-05-t2'

const RUNS = [
  'npm test',
  'npm t',
  'npm run test',
  'npm run build',
  'npm run dev',
  'npm run test:watch',
  'npm run build 2>&1 | tail -5',
  `npm --prefix ${T} test`,
  `npm --prefix ${T} test 2>&1 | tail -30`,
  `npm --prefix ${T} run build 2>&1 | tail -6`,
  `npm --prefix ${T} test -- src/debug.test.js 2>&1 | grep -E "Error" | head`,
  `npm run build --prefix ${T}`,
  `npm --silent --prefix=${T} test`,
  `cd ${T} && npm test`,
  `cd ${T} && npm test 2>&1 | tail -30`,
  `cd ${T}; npm run build`,
  `(cd ${T} && npm test)`,
  `cd ${T} && npx vitest run 2>&1 | tail -40`,
  'npx vitest',
  'npx vitest run src/App.test.jsx',
  'npx --yes vitest run',
  'npx vite build',
  'npx -y vite build --mode development',
  'vitest run',
  'vitest',
  'vite build',
  './node_modules/.bin/vitest run',
  'node_modules/.bin/vite build',
  `${T}/node_modules/.bin/vitest run`,
  'node node_modules/vitest/vitest.mjs run',
  'node ./node_modules/vite/bin/vite.js build',
  'CI=1 npm test',
  'CI=1 FORCE_COLOR=0 npx vitest run',
  'timeout 120 npm test',
  'pnpm test',
  'pnpm build',
  'yarn test',
  'yarn build',
  'npm exec vitest run',
  'bash -c "cd /tmp/app && npm test"',
  `ls src && npm run build && npm test`,
]

const NOT_RUNS = [
  'ls -la',
  `cd ${T} && cat src/App.jsx src/main.js vite.config.js index.html`,
  `cd ${T} && for f in src/* vite.config.js index.html; do echo "=== $f"; cat $f; done`,
  `grep -rn "run(" ${T}/node_modules/sygnal/dist/vite/ | head -20`,
  `sed -n 50,112p ${T}/node_modules/sygnal/dist/vite/plugin.mjs`,
  'cat vite.config.js',
  'npm install',
  'npm ci --no-audit',
  'npm ls vitest',
  'npm view vitest version',
  'echo npm test',
  'node -e "console.log(1)"',
  'git status',
  'npm pack',
]

test('counts every common build/test invocation form', () => {
  for (const cmd of RUNS) assert.equal(isRunCommand(cmd), true, `should count: ${cmd}`)
})

test('does not count reads, installs or unrelated commands', () => {
  for (const cmd of NOT_RUNS) assert.equal(isRunCommand(cmd), false, `should not count: ${cmd}`)
})

test('here-document bodies are not commands, but what follows them is', () => {
  const writeTest = `cd ${T} && cat > src/App.test.jsx <<'EOF'\nimport { describe, it } from 'vitest'\nvitest\nnpm test\nEOF`
  assert.equal(isRunCommand(writeTest), false)
  assert.equal(isRunCommand(`${writeTest}\nnpm test 2>&1 | tail`), true)
  assert.equal(isRunCommand(`python3 - <<EOF\nimport subprocess\nnpm run build\nEOF\nls`), false)
  assert.equal(isRunCommand(`cat <<-"END" > x.js\n  vite build\n  END\nnpx vitest run`), true)
})

test('splits chains into simple commands', () => {
  assert.deepEqual(splitCommands('cd /a && npm test 2>&1 | tail -3'), ['cd /a', 'npm test 2>', '1', 'tail -3'])
  assert.deepEqual(splitCommands('(cd /a && npm test)'), ['cd /a', 'npm test'])
})

test('edit detection', () => {
  assert.equal(isEditCommand("sed -i '' 's/a/b/' src/App.jsx"), true)
  assert.equal(isEditCommand('cat > src/App.jsx'), true)
  assert.equal(isEditCommand('echo hi | tee src/x.js'), true)
  assert.equal(isEditCommand('npm test 2>&1 | tail'), false)
  assert.equal(isEditCommand('cat src/App.jsx'), false)
})

test('peek audit: harness paths, hidden dirs and hidden test files are flagged', () => {
  assert.equal(mentionsHidden('{"file_path":"/repo/evals/agent-ergonomics/hidden/03-events-status/status.hidden.jsx"}'), true)
  assert.equal(mentionsHidden('{"command":"ls /repo/evals/agent-ergonomics"}'), true)
  assert.equal(mentionsHidden('{"command":"cat __hidden__/dom.js"}'), true)
  assert.equal(mentionsHidden('{"pattern":"**/*.hidden.jsx"}'), true)
  assert.equal(mentionsHidden('{"command":"find / -path */hidden/*"}'), true)
})

test('peek audit: a trial dir under .../evals/... is not a hit (G-009)', () => {
  assert.equal(mentionsHidden(`{"command":"npm --prefix ${T} test"}`, T), false)
  assert.equal(mentionsHidden(`{"file_path":"${T}/src/App.jsx"}`, T), false)
  assert.equal(mentionsHidden('{"command":"ls /tmp/sygnal-evals/trials"}'), false)
  assert.equal(mentionsHidden('{"command":"grep -rn evals src"}'), false)
})

test('peek audit: the trial dir is ignored even if its own path looks suspicious', () => {
  const weird = '/tmp/hidden/trial'
  assert.equal(mentionsHidden(`{"file_path":"${weird}/src/App.jsx"}`, weird), false)
  assert.equal(mentionsHidden(`{"file_path":"${weird}/src/App.jsx"}`), true)
  assert.equal(mentionsHidden(`{"file_path":"${weird}/__hidden__/x.hidden.jsx"}`, weird), true)
})
