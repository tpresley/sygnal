// PLAN-2 0-B fix2: Bash calls that write project files are edits (and test
// authoring when they write tests), also when the same call runs the tests.
// The fixture is cut from the real v2-smoke Sygnal trial (sygnal-01-t1), whose
// whole change was one `python3 - <<'EOF' … open(p,'w') … EOF` + `cat > src/App.test.js
// <<'EOF' … EOF` + `npm test` call. Run: node --test evals/agent-ergonomics/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bashEdits, isEditCommand, isRunCommand, scriptWriteTargets, heredocs, transcriptStats } from '../lib/transcript.mjs'
import { basePhase, isEditCall, isVerifyCall, bashWritesTest, bashTestShare } from '../analysis/lib/classify.mjs'
import { parseTranscriptLines } from '../analysis/lib/parse.mjs'
import { buildTimeline } from '../analysis/lib/timeline.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SMOKE = fs.readFileSync(path.join(HERE, 'fixtures', 'v2-smoke-sygnal-01.transcript.jsonl'), 'utf8')
const TRIAL = '/private/tmp/sygnal-evals/trials/v2-smoke/sygnal-01-t1'
const bashCalls = SMOKE.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .flatMap((o) => (o.type === 'assistant' ? o.message.content : []))
  .filter((b) => b.type === 'tool_use' && b.name === 'Bash')
const EDIT_AND_TEST = bashCalls.find((b) => /python3 - <<'EOF'/.test(b.input.command)).input.command

test('the real smoke call: an edit of App.jsx, a new test file, and a test run', () => {
  assert.deepEqual(bashEdits(EDIT_AND_TEST), { edits: true, targets: ['src/App.test.js', 'src/App.jsx'] })
  assert.equal(isRunCommand(EDIT_AND_TEST), true)
  const call = { name: 'Bash', input: { command: EDIT_AND_TEST } }
  assert.equal(basePhase(call), 'implement', 'App.jsx is not a test, so the edit is implementation')
  assert.equal(isEditCall(call), true)
  assert.equal(isVerifyCall(call), true)
  assert.equal(bashWritesTest(EDIT_AND_TEST), true)
  const share = bashTestShare(EDIT_AND_TEST)
  assert.ok(share > 0.4 && share < 0.8, `test share ${share}`)
  assert.equal(bashTestShare("sed -i '' 's/a/b/' src/App.jsx"), null)
  // The orientation calls before it are not edits.
  for (const b of bashCalls.filter((x) => x.input.command !== EDIT_AND_TEST)) assert.equal(isEditCommand(b.input.command), false, b.input.command)
})

test('the real smoke transcript: one edit round and one iteration; implement and verify time both counted', () => {
  const s = transcriptStats(SMOKE, TRIAL)
  assert.equal(s.edits, 1)
  assert.equal(s.editRounds, 1)
  assert.equal(s.iterations, 1)
  const tl = buildTimeline(parseTranscriptLines(SMOKE.split('\n')), { arm: 'sygnal' })
  assert.equal(tl.editRounds, 1)
  assert.equal(tl.iterations, 1)
  // Writing the call (7.5 s) is split by the text written: App.jsx edit vs the new test file.
  assert.ok(tl.phases.implement > 1, `implement ${tl.phases.implement} s`)
  assert.ok(tl.phases['test-authoring'] > 1, `test-authoring ${tl.phases['test-authoring']} s`)
  assert.ok(Math.abs(tl.phases.implement + tl.phases['test-authoring'] - 7.5) < 0.3)
  assert.ok(tl.phases.verify > 0, `verify ${tl.phases.verify} s (running it)`)
})

test('bashEdits: the forms agents use', () => {
  const t = (cmd) => bashEdits(cmd)
  assert.deepEqual(t("cat > src/A.jsx <<'EOF'\nx > y.js\nEOF"), { edits: true, targets: ['src/A.jsx'] }, 'heredoc body is not parsed as redirects')
  assert.deepEqual(t('echo "x" >> src/styles.css'), { edits: true, targets: ['src/styles.css'] })
  assert.deepEqual(t('printf x | tee src/a.test.js'), { edits: true, targets: ['src/a.test.js'] })
  assert.deepEqual(t("sed -i '' 's/a/b/' src/App.jsx src/B.jsx"), { edits: true, targets: ['src/App.jsx', 'src/B.jsx'] })
  assert.deepEqual(t("perl -pi -e 's/a/b/' src/App.jsx"), { edits: true, targets: ['src/App.jsx'] })
  assert.deepEqual(t(`node -e "require('fs').writeFileSync('src/x.test.js', 'it()')"`), { edits: true, targets: ['src/x.test.js'] })
  assert.deepEqual(t(`python3 -c "open('src/a.js','w').write('x')"`), { edits: true, targets: ['src/a.js'] })
  assert.deepEqual(t("node --input-type=module <<'EOF'\nimport fs from 'fs'\nconst file = 'src/App.jsx'\nfs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('a', 'b'))\nEOF"), { edits: true, targets: ['src/App.jsx'] })
  assert.deepEqual(t("python3 - <<'EOF'\nfrom pathlib import Path\np = Path('src/App.jsx')\np.write_text(p.read_text().replace('a','b'))\nEOF"), { edits: true, targets: ['src/App.jsx'] })
  assert.deepEqual(t("python3 - <<'EOF'\nfor f in files:\n    open(f, 'w').write('x')\nEOF"), { edits: true, targets: [] }, 'unresolvable target: still an edit')
  assert.deepEqual(t("patch -p1 <<'EOF'\n--- a/src/App.jsx\n+++ b/src/App.jsx\n@@ -1 +1 @@\n-a\n+b\nEOF"), { edits: true, targets: ['src/App.jsx'] })
  assert.deepEqual(t("apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src/App.jsx\n@@\n-a\n+b\n*** End Patch\nEOF"), { edits: true, targets: ['src/App.jsx'] })
  assert.equal(t('git apply fix.diff').edits, true)
  // Not edits
  for (const cmd of ['cat src/App.jsx', 'npm test 2>&1 | tail -20', 'npm test > /tmp/out.log 2>&1', 'echo hi > /dev/null', 'ls >&2', 'grep -n x src/*.jsx', "python3 - <<'EOF'\nprint(open('src/App.jsx').read())\nEOF", "sed -n '1,20p' src/App.jsx"]) {
    assert.equal(t(cmd).edits, false, cmd)
  }
})

test('heredocs and scriptWriteTargets', () => {
  assert.deepEqual(heredocs("cat > a.js <<'EOF'\nbody\nEOF\npython3 - <<EOF\nprint(1)\nEOF").map((h) => h.header.trim()), ['cat > a.js', 'python3 -'])
  assert.deepEqual(scriptWriteTargets("p='src/a.js'\nopen(p, mode='w')"), ['src/a.js'])
  assert.deepEqual(scriptWriteTargets("fs.appendFileSync('log.md', x)"), ['log.md'])
  assert.deepEqual(scriptWriteTargets("open('a.js').read()"), [])
})

test('an edit+test Bash call that writes only tests is test authoring', () => {
  const cmd = "cat > src/pin.test.jsx <<'EOF'\nit()\nEOF\nnpm test"
  assert.equal(basePhase({ name: 'Bash', input: { command: cmd } }), 'test-authoring')
  assert.equal(isVerifyCall({ name: 'Bash', input: { command: cmd } }), true)
})
