// Run one prepared trial headless with `claude -p` (used by run-trial.mjs and
// orchestrate.mjs). See lib/headless.mjs for the posture and the file layout.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildClaudeArgs, trialEnv, stampLine, summarizeRun, parseJsonl, trialFiles, DEFAULT_TIMEOUT_MIN } from './headless.mjs'

/**
 * @param {object} o
 * @param {string} o.dest            prepared trial dir (prepare.mjs output)
 * @param {string} [o.model]         --model for claude (alias or full id)
 * @param {number} [o.timeoutMin]    hard limit; the process group is killed after it
 * @param {string} [o.claudeBin]     default "claude" (tests use a fake)
 * @param {string} [o.permissionMode]
 * @param {string[]|string} [o.tools]
 * @param {string} [o.effort]
 * @param {number} [o.maxBudgetUsd]
 * @param {boolean} [o.force]        overwrite an existing transcript
 * @param {(line: object) => void} [o.onEvent]
 * @param {(child) => void} [o.onSpawn]  [o.onExit]   process-group bookkeeping for the caller
 * @returns {Promise<object>} the run meta (also written to <dest>.run.json)
 */
export function runTrial(o) {
  const dest = path.resolve(o.dest)
  const files = trialFiles(dest)
  if (!fs.existsSync(path.join(dest, 'package.json'))) throw new Error(`${dest} is not a prepared trial dir (no package.json)`)
  if (!fs.existsSync(files.prompt)) throw new Error(`No prompt file at ${files.prompt} (run prepare.mjs first)`)
  if (fs.existsSync(files.transcript) && !o.force) throw new Error(`${files.transcript} exists; this trial already ran (pass force to overwrite)`)

  const prompt = fs.readFileSync(files.prompt, 'utf8').trim()
  const timeoutMin = o.timeoutMin ?? DEFAULT_TIMEOUT_MIN
  const args = buildClaudeArgs({ prompt, model: o.model, permissionMode: o.permissionMode, tools: o.tools, effort: o.effort, maxBudgetUsd: o.maxBudgetUsd })
  const bin = o.claudeBin ?? 'claude'
  const out = fs.openSync(files.transcript, 'w')
  const err = fs.openSync(files.stderr, 'w')
  const startedAt = new Date()

  return new Promise((resolve) => {
    // Own process group, so a timeout also kills the test runners the agent started.
    const child = spawn(bin, args, { cwd: dest, env: trialEnv(process.env), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    if (child.pid && o.onSpawn) o.onSpawn(child)
    let buf = ''
    let timedOut = false
    let spawnError = null
    const write = (raw) => {
      const line = stampLine(raw)
      if (!line) return
      fs.writeSync(out, line + '\n')
      if (o.onEvent) {
        try {
          o.onEvent(JSON.parse(line))
        } catch {}
      }
    }
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        write(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    })
    child.stderr.on('data', (d) => fs.writeSync(err, d))
    const kill = (sig) => {
      try {
        process.kill(-child.pid, sig)
      } catch {
        try {
          child.kill(sig)
        } catch {}
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill('SIGTERM')
      setTimeout(() => kill('SIGKILL'), 10_000).unref()
    }, timeoutMin * 60_000)
    child.on('error', (e) => {
      spawnError = e.message
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (o.onExit) o.onExit(child)
      if (buf.trim()) write(buf)
      fs.closeSync(out)
      fs.closeSync(err)
      const endedAt = new Date()
      const summary = summarizeRun(parseJsonl(fs.readFileSync(files.transcript, 'utf8')))
      const meta = {
        dest,
        transcript: files.transcript,
        method: 'headless',
        modelRequested: o.model ?? null,
        model: summary.model,
        permissionMode: args[args.indexOf('--permission-mode') + 1],
        tools: args[args.indexOf('--tools') + 1].split(','),
        effort: o.effort ?? null,
        timeoutMin,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        wallMs: endedAt - startedAt,
        exitCode: code,
        signal,
        timedOut,
        spawnError,
        ok: !spawnError && !timedOut && code === 0 && summary.completed && !summary.isError,
        ...summary,
      }
      fs.writeFileSync(files.meta, JSON.stringify(meta, null, 2) + '\n')
      resolve(meta)
    })
  })
}
