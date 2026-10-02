// Process guard (G-127): trial agents must not run machine-wide process kills
// (pkill, killall), and the harness's own timeout must still kill the trial's
// process group. Run: node --test evals/agent-ergonomics/tests/*.unit.mjs
//
// The scripted `pkill` below only ever reaches the shims: every run here has
// the guard on, and the test fails if the refusal is missing.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildClaudeArgs, buildPreflightArgs, writeProcessGuard, guardEnv, guardPaths, GUARD_DISALLOWED_TOOLS, GUARD_MESSAGE, PROCESS_GUARD, parseJsonl } from '../lib/headless.mjs'
import { runTrial } from '../lib/runner.mjs'
import { processKills, transcriptStats } from '../lib/transcript.mjs'
import { processKillNote } from '../analysis/lib/report.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FAKE = path.join(HERE, 'fake-claude.mjs')
const PATTERN = 'sygnal-eval-guard-test-no-such-process'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'))
const mk = (name) => {
  const dest = path.join(root, name)
  fs.mkdirSync(dest)
  fs.writeFileSync(path.join(dest, 'package.json'), '{}')
  fs.writeFileSync(`${dest}.prompt.txt`, 'do it')
  return dest
}
const withEnv = (vars, fn) => {
  const old = { ...process.env }
  Object.assign(process.env, vars)
  return fn().finally(() => {
    for (const k of Object.keys(vars)) if (old[k] === undefined) delete process.env[k]
    else process.env[k] = old[k]
  })
}
/** The tool_result of each scripted Bash call, by command. */
const bashResults = (transcript) => {
  const ev = parseJsonl(fs.readFileSync(transcript, 'utf8'))
  const cmds = new Map()
  for (const e of ev) for (const b of e.message?.content ?? []) if (b.type === 'tool_use' && b.name === 'Bash') cmds.set(b.id, b.input.command)
  const out = {}
  for (const e of ev) for (const b of e.message?.content ?? []) if (b.type === 'tool_result' && cmds.has(b.tool_use_id)) out[cmds.get(b.tool_use_id)] = { text: b.content, isError: b.is_error }
  return out
}

test('buildClaudeArgs / buildPreflightArgs deny pkill, killall and kill by default', () => {
  const a = buildClaudeArgs({ prompt: 'x' })
  const rules = a[a.indexOf('--disallowedTools') + 1].split(',')
  for (const r of ['Bash(pkill:*)', 'Bash(killall:*)', 'Bash(kill:*)']) assert.ok(rules.includes(r), r)
  assert.deepEqual(rules, GUARD_DISALLOWED_TOOLS)
  assert.ok(!/\bBash\(/.test(a[a.indexOf('--allowedTools') + 1]), 'no Bash rule is pre-approved')
  assert.ok(!buildClaudeArgs({ prompt: 'x', processGuard: false }).includes('--disallowedTools'))
  const p = buildPreflightArgs({})
  assert.equal(p[p.indexOf('--disallowedTools') + 1], GUARD_DISALLOWED_TOOLS.join(','))
  assert.equal(p[p.indexOf('--tools') + 1], '', 'still a no-tool preflight')
})

test('writeProcessGuard: shims refuse and exit 1; the env file puts them first on PATH', () => {
  const g = writeProcessGuard(path.join(root, 'shim'))
  assert.deepEqual(g, guardPaths(path.join(root, 'shim')))
  for (const c of ['pkill', 'killall', 'kill']) {
    const r = spawnSync(path.join(g.bin, c), ['-f', PATTERN], { encoding: 'utf8' })
    assert.equal(r.status, 1)
    assert.equal(r.stderr.trim(), `${c}: ${GUARD_MESSAGE}`)
  }
  // Through a shell whose PATH puts the system dirs first (as a login shell's path_helper would): the env file wins.
  const r = spawnSync('/bin/sh', ['-c', `. "${g.envFile}"; command -v pkill; pkill -f ${PATTERN}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })
  assert.equal(r.stdout.trim(), path.join(g.bin, 'pkill'))
  assert.equal(r.status, 1)
  const env = guardEnv({ PATH: '/usr/bin', HOME: '/h' }, g)
  assert.equal(env.PATH, `${g.bin}${path.delimiter}/usr/bin`)
  assert.equal(env.CLAUDE_ENV_FILE, g.envFile)
})

test('runTrial (fake CLI): the deny rules reach the CLI, a scripted pkill is refused, the meta records the guard', async () => {
  const log = path.join(root, 'argv.jsonl')
  const dest = mk('sygnal-01-t1')
  const meta = await withEnv({ FAKE_CLAUDE_BASH: `pkill -f ${PATTERN} || true`, FAKE_CLAUDE_ARGV_LOG: log }, () => runTrial({ dest, model: 'claude-opus-5-5', claudeBin: FAKE }))
  assert.equal(meta.agentRan, true)
  assert.equal(meta.processGuard, PROCESS_GUARD)
  assert.deepEqual(meta.disallowedTools, GUARD_DISALLOWED_TOOLS)
  const argv = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop()).argv
  assert.equal(argv[argv.indexOf('--disallowedTools') + 1], GUARD_DISALLOWED_TOOLS.join(','))
  const res = bashResults(meta.transcript)[`pkill -f ${PATTERN} || true`]
  assert.equal(res.isError, true)
  assert.match(res.text, /has been denied/)
  // The scan sees the attempt, blocked or not.
  assert.equal(transcriptStats(fs.readFileSync(meta.transcript, 'utf8')).machineWideKills, 1)
})

test('runTrial (fake CLI): with the deny rules bypassed, the PATH shims still refuse pkill and killall', async () => {
  const dest = mk('sygnal-01-t2')
  const cmds = [`pkill -f ${PATTERN}`, `killall ${PATTERN}`, `echo 1 | xargs kill -0`]
  const meta = await withEnv({ FAKE_CLAUDE_BASH: cmds.join('\n'), FAKE_CLAUDE_IGNORE_DENY: '1' }, () => runTrial({ dest, model: 'claude-opus-5-5', claudeBin: FAKE }))
  const res = bashResults(meta.transcript)
  for (const c of cmds) {
    assert.equal(res[c].isError, true, c)
    assert.match(res[c].text, /Exit code 1/)
    assert.ok(res[c].text.includes(GUARD_MESSAGE), c)
  }
  assert.ok(fs.existsSync(path.join(guardPaths(dest).bin, 'pkill')))
})

test('runTrial timeout still kills the trial process group (fake CLI hang + grandchild)', async () => {
  const dest = mk('sygnal-01-t3')
  const pidFile = path.join(root, 'child.pid')
  const meta = await withEnv({ FAKE_CLAUDE_MODE: 'hang', FAKE_CLAUDE_CHILD_PID: pidFile }, () => runTrial({ dest, model: 'claude-opus-5-5', claudeBin: FAKE, timeoutMin: 0.03 }))
  assert.equal(meta.timedOut, true)
  assert.equal(meta.processGuard, PROCESS_GUARD)
  const pid = Number(fs.readFileSync(pidFile, 'utf8'))
  assert.ok(pid > 0)
  let alive = true
  for (let i = 0; i < 50 && alive; i++) {
    try {
      process.kill(pid, 0)
      await new Promise((r) => setTimeout(r, 100))
    } catch {
      alive = false
    }
  }
  assert.equal(alive, false, 'the grandchild in the trial process group was killed')
})

test('processKills: machine-wide kills vs own-PID kills', () => {
  const kinds = (c) => processKills(c).map((k) => `${k.kind}${k.machineWide ? '!' : ''}`)
  assert.deepEqual(kinds('pkill -f "vite" || true'), ['pkill!'])
  assert.deepEqual(kinds('cd app && killall node 2>/dev/null'), ['killall!'])
  assert.deepEqual(kinds('lsof -ti:5173 | xargs kill -9 2>/dev/null'), ['xargs kill!'])
  assert.deepEqual(kinds('kill $(pgrep -f vite)'), ['kill $(lookup)!'])
  assert.deepEqual(kinds('kill -9 $(lsof -ti:5173)'), ['kill $(lookup)!'])
  assert.deepEqual(kinds('/usr/bin/pkill -f vitest'), ['pkill!'])
  assert.deepEqual(kinds('fuser -k 5173/tcp'), ['fuser -k!'])
  assert.deepEqual(kinds('kill -9 1234'), ['kill -9'])
  for (const c of ['kill 1234', 'kill %1', 'kill $VITE_PID', 'kill $(cat /tmp/vite.pid)', 'echo pkill', 'grep killall README.md', 'npm test']) assert.deepEqual(kinds(c), [], c)
  // In a heredoc body it is file content, not a command.
  assert.deepEqual(kinds("cat > notes.md <<'EOF'\npkill -f vite\nEOF"), [])
})

test('processKillNote lists contaminated trials for "Method and limits"', () => {
  assert.match(processKillNote([{ trial: 'a', processKills: [] }]), /no trial ran a machine-wide/)
  const n = processKillNote([
    { trial: 'react-01-t1', processKills: [{ kind: 'pkill', machineWide: true }, { kind: 'pkill', machineWide: true }] },
    { trial: 'react-02-t5', processKills: [{ kind: 'killall', machineWide: true }] },
    { trial: 'sygnal-01-t1', processKills: [{ kind: 'kill -9', machineWide: false }] },
  ])
  assert.match(n, /2 unguarded trial\(s\) ran machine-wide process kills/)
  assert.match(n, /react-01-t1 \(2: pkill\); react-02-t5 \(1: killall\)/)
  assert.match(n, /kill -9.*sygnal-01-t1/)
  const g = processKillNote([{ trial: 'react-01-t2', processGuard: 1, processKills: [{ kind: 'pkill', machineWide: true }] }])
  assert.match(g, /refused by the guard.*react-01-t2 \(1: pkill\)/)
  assert.doesNotMatch(g, /unguarded/)
})
