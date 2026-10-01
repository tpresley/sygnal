// Time-by-phase attribution and failure episodes for one parsed transcript.
//
// Every interval between two consecutive timestamped events is owned by the
// later event:
//   - a tool_use (the model was generating that call)  -> the call's phase
//   - a tool_result (the tool was running)              -> the call's phase
//   - a text/thinking block in a message that also has a tool call -> the
//     phase of that message's first call (planning it)
//   - a text block in a message with no tool call      -> 'think'
//     ('report' once the final report has been handed back)
// So the phases sum to the whole wall time; time we can't classify lands in
// 'other' and is reported as unattributed.
//
// Overlays: after a build/test run fails, every call until the next passing
// run is 'debug', or 'tooling-friction' if the failure matched a known
// defect in the catalog. A call the environment refused (worktree guard) is
// 'tooling-friction' (HARNESS-GUARD) on its own.
import { basePhase, learnTopic, isVerifyCall, isEditCall, isRefused, verifyOutcome, commandOutcome, errorSignature, uncataloguedCause, bashTestShare } from './classify.mjs'
import { matchResult, frictionIds, CATALOG_BY_ID } from '../catalog.mjs'

/**
 * @param parsed   output of parseTranscriptLines
 * @param opts     { arm, reportIds: catalog IDs matched in the final report }
 */
export function buildTimeline(parsed, { arm = null, reportIds = [] } = {}) {
  const { events, calls, firstTs, lastTs } = parsed
  const byId = new Map(calls.map((c) => [c.id, c]))
  const firstCallOfMsg = new Map()
  for (const c of calls) if (!firstCallOfMsg.has(c.msgId)) firstCallOfMsg.set(c.msgId, c)

  const phaseMs = {}
  const frictionMs = {} // catalog id -> ms
  const learnMs = {} // learn topic -> ms; partitions the learn phase
  const add = (phase, ms, fid = null) => {
    phaseMs[phase] = (phaseMs[phase] ?? 0) + ms
    if (phase === 'tooling-friction' && fid) frictionMs[fid] = (frictionMs[fid] ?? 0) + ms
    if (phase === 'debug' && failing) failing.debugMs += ms
  }
  const charge = (call, ms) => {
    add(call.phase, ms, call.fid)
    if (call.phase === 'learn') {
      const t = learnTopic(call)
      learnMs[t] = (learnMs[t] ?? 0) + ms
    }
  }

  let failing = null // open debug episode
  const episodes = []
  const failures = []
  let reported = false

  const phaseFor = (call, baseOverride = null) => {
    if (call.phase && !baseOverride) return call
    const base = baseOverride ?? basePhase(call)
    let phase = base
    let fid = null
    if (isRefused(call.result)) {
      phase = 'tooling-friction'
      fid = 'HARNESS-GUARD'
    } else if (failing && base !== 'report' && base !== 'other') {
      if (failing.frictionIds.length) {
        phase = 'tooling-friction'
        fid = failing.frictionIds[0]
      } else phase = 'debug'
    }
    return { phase, fid, base }
  }

  let prev = firstTs
  let first = true
  let afterSkill = false
  for (const e of events) {
    const dt = Math.max(0, e.ts - (prev ?? e.ts))
    prev = e.ts
    if (afterSkill) {
      // The Skill tool injects the whole SKILL.md; the model reads it while
      // producing its next step. Charge that one interval to learn/skill-load
      // rather than to whatever call comes next.
      afterSkill = false
      add('learn', dt)
      learnMs['skill-load'] = (learnMs['skill-load'] ?? 0) + dt
      if (e.kind === 'call') {
        const call = byId.get(e.callId)
        Object.assign(call, phaseFor(call))
      } else if (e.kind === 'result') {
        const call = byId.get(e.callId)
        if (call) {
          if (!call.phase) Object.assign(call, phaseFor(call))
          handleResult(call)
        }
      }
      continue
    }
    if (first) {
      // Reading the prompt and deciding the first step: always orient, so the
      // arms are comparable (Sygnal agents' first call is usually the Skill).
      first = false
      add('orient', dt)
      if (e.kind === 'call') {
        const call = byId.get(e.callId)
        Object.assign(call, phaseFor(call))
      }
      continue
    }
    if (e.kind === 'call') {
      const call = byId.get(e.callId)
      const p = phaseFor(call)
      Object.assign(call, { phase: p.phase, fid: p.fid, base: p.base })
      // One Bash call that writes source and tests: split its writing time by
      // the text written to each (outside a failure overlay).
      const share = call.name === 'Bash' && (p.phase === 'implement' || p.phase === 'test-authoring') ? bashTestShare(call.input?.command) : null
      if (share != null && share > 0 && share < 1) {
        add('test-authoring', dt * share)
        add('implement', dt * (1 - share))
      } else charge(call, dt)
    } else if (e.kind === 'result') {
      const call = byId.get(e.callId)
      if (!call) {
        add('other', dt)
        continue
      }
      if (!call.phase) Object.assign(call, phaseFor(call))
      // A Bash call that edits and then runs the tests: writing it was the edit
      // phase (charged at the call); running it is verify.
      if (call.base !== 'verify' && isVerifyCall(call)) {
        const v = phaseFor(call, 'verify')
        charge({ ...v, name: call.name, input: call.input }, dt)
      } else charge(call, dt)
      handleResult(call)
      if (call.name === 'Skill') afterSkill = true
    } else {
      // text / thinking
      if (e.msgHasTool) {
        const c = firstCallOfMsg.get(e.msgId)
        if (c) charge({ ...phaseFor(c), name: c.name, input: c.input }, dt)
        else add('think', dt)
      } else {
        const ph = reported ? 'report' : failing ? (failing.frictionIds.length ? 'tooling-friction' : 'debug') : 'think'
        add(ph, dt, ph === 'tooling-friction' ? failing.frictionIds[0] : null)
      }
    }
  }

  function handleResult(call) {
    if (call.name === 'SubagentHandback') reported = true
    const res = call.result
    if (!res) return
    if (isRefused(res)) {
      failures.push({ ts: res.ts, kind: isVerifyCall(call) ? 'verify' : 'command', tool: call.name, signature: 'environment refused the command (worktree guard)', catalog: ['HARNESS-GUARD'], cause: 'harness' })
      return
    }
    const verifyish = isVerifyCall(call) || call.base === 'verify'
    if (verifyish) {
      const outcome = verifyOutcome(res)
      call.outcome = outcome
      if (outcome === 'fail') {
        const signature = errorSignature(res.text)
        const resultIds = matchResult(res.text, arm)
        const fids = frictionIds(resultIds, reportIds)
        const cause = fids.length ? (CATALOG_BY_ID[fids[0]].kind === 'harness' ? 'harness' : 'known-defect') : resultIds.some((id) => CATALOG_BY_ID[id]?.kind === 'pitfall') ? 'agent-mistake' : uncataloguedCause(signature)
        failures.push({ ts: res.ts, kind: 'verify', tool: call.name, signature, catalog: resultIds, friction: fids, cause })
        if (failing && failing.frictionIds.length && !fids.length && call.ts > failing.startTs && cause !== 'unknown (output truncated)') {
          // The known defect was worked around and the run now fails for an
          // unrelated reason (usually the agent's own test): a new episode.
          failing.iterations++
          closeEpisode(res.ts, true)
        }
        if (!failing) {
          failing = { startTs: res.ts, signature, resultIds: [...resultIds], frictionIds: [...fids], cause, iterations: 0, signatures: [signature], debugMs: 0 }
        } else {
          failing.iterations++
          if (!failing.frictionIds.length && fids.length && failing.debugMs) {
            // The episode turns out to be a known defect (e.g. the first run's
            // output was truncated by `tail`): re-label its debug time.
            phaseMs.debug -= failing.debugMs
            const moved = failing.debugMs
            failing.debugMs = 0
            add('tooling-friction', moved, fids[0])
          }
          for (const id of resultIds) if (!failing.resultIds.includes(id)) failing.resultIds.push(id)
          for (const id of fids) if (!failing.frictionIds.includes(id)) failing.frictionIds.push(id)
          if (!failing.signatures.includes(signature)) failing.signatures.push(signature)
          if (failing.cause !== 'known-defect' && fids.length) failing.cause = 'known-defect'
        }
      } else if (outcome === 'pass' && failing && call.ts > failing.startTs) {
        // Only a run issued after the failure was seen can close it (parallel
        // build + test calls issued together don't).
        failing.iterations++
        closeEpisode(res.ts, true)
      }
    } else if (commandOutcome(res) === 'error') {
      const signature = errorSignature(res.text)
      failures.push({ ts: res.ts, kind: 'command', tool: call.name, signature, catalog: matchResult(res.text, arm), cause: 'other' })
    }
  }

  function closeEpisode(endTs, resolved) {
    episodes.push({
      startTs: failing.startTs,
      endTs,
      seconds: Math.round((endTs - failing.startTs) / 100) / 10,
      iterations: failing.iterations,
      signature: failing.signature,
      signatures: failing.signatures.slice(0, 5),
      catalog: failing.resultIds,
      friction: failing.frictionIds,
      cause: failing.cause,
      resolved,
    })
    failing = null
  }
  if (failing) closeEpisode(lastTs, false)

  // Iterations / edit rounds exactly as transcript-stats.mjs counts them.
  let iterations = 0
  let refusedIterations = 0
  let edits = 0
  let editRounds = 0
  let inRound = false
  for (const c of calls) {
    // An edit-and-test Bash call is an edit first, then an iteration.
    if (isEditCall(c)) {
      edits++
      if (!inRound) {
        editRounds++
        inRound = true
      }
    }
    if (isVerifyCall(c)) {
      iterations++
      if (isRefused(c.result)) refusedIterations++
      inRound = false
    }
  }

  const wallMs = (lastTs ?? 0) - (firstTs ?? 0)
  const phases = {}
  for (const [k, v] of Object.entries(phaseMs)) phases[k] = Math.round(v / 100) / 10
  const friction = {}
  for (const [k, v] of Object.entries(frictionMs)) friction[k] = Math.round(v / 100) / 10
  const learn = {}
  for (const [k, v] of Object.entries(learnMs)) learn[k] = Math.round(v / 100) / 10
  const attributedMs = Object.entries(phaseMs).filter(([k]) => k !== 'other').reduce((s, [, v]) => s + v, 0)

  return {
    wallSeconds: Math.round(wallMs / 100) / 10,
    phases,
    friction,
    learn,
    attributedShare: wallMs ? Math.round((attributedMs / wallMs) * 1000) / 1000 : 1,
    iterations,
    effectiveIterations: iterations - refusedIterations,
    edits,
    editRounds,
    episodes,
    failures,
  }
}
