// Parse a Claude Code agent transcript (JSONL) into a flat, time-ordered model:
//   { firstTs, lastTs, calls[], events[], usage, finalReport, skillInvoked }
//
// - calls: one per tool_use block, deduplicated by id, with its result attached
//   ({ id, name, input, ts, msgId, result: { ts, text, isError } | null }).
// - events: every timestamped thing the timeline needs, in order:
//   { ts, kind: 'call' | 'result' | 'text' | 'thinking', callId?, msgId?, text? }
//   Assistant messages are streamed as several JSONL lines that share
//   message.id; each line carries one content block.
// - headless: for a `claude -p --output-format stream-json` transcript written
//   by run-trial.mjs (every line stamped with `timestamp`), the `system/init`
//   and final `result` events: { model, costUsd, durationMs, tokens,
//   outputTokens, numTurns }; null for subagent transcripts. The init line's
//   timestamp starts the clock, like the prompt line of a subagent log.
// - usage: summed over unique assistant messages (the last line of a message
//   carries its final usage).
import fs from 'node:fs'

/** Flatten a tool_result content (string | blocks[]) into text. */
export function resultText(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : b?.type === 'text' ? b.text : b?.type === 'tool_reference' ? `[tool:${b.tool_name}]` : ''))
      .join('\n')
  }
  return JSON.stringify(content)
}

export function parseTranscriptFile(file) {
  return parseTranscriptLines(fs.readFileSync(file, 'utf8').split('\n'))
}

/** Parse JSONL lines (strings or already-parsed objects). */
export function parseTranscriptLines(lines) {
  const calls = new Map()
  const events = []
  const msgUsage = new Map() // msgId -> usage (last seen wins)
  const msgOrder = []
  const msgHasTool = new Set()
  let firstTs = null
  let lastTs = null
  let lastAssistantText = null
  let skillInvoked = false
  let skillInjectedBytes = 0
  let n = 0
  let init = null
  let result = null

  for (const raw of lines) {
    let obj = raw
    if (typeof raw === 'string') {
      if (!raw.trim()) continue
      try {
        obj = JSON.parse(raw)
      } catch {
        continue
      }
    }
    const type = obj.type
    if (type === 'system' && obj.subtype === 'init') {
      init = obj
      const t0 = obj.timestamp ? Date.parse(obj.timestamp) : null
      if (t0 != null && !Number.isNaN(t0) && (firstTs == null || t0 < firstTs)) firstTs = t0
    }
    if (type === 'result') result = obj
    if (type !== 'assistant' && type !== 'user') continue
    const ts = obj.timestamp ? Date.parse(obj.timestamp) : null
    if (ts == null || Number.isNaN(ts)) continue
    if (firstTs == null || ts < firstTs) firstTs = ts
    if (lastTs == null || ts > lastTs) lastTs = ts
    const msg = obj.message ?? {}
    const seq = n++

    if (type === 'assistant') {
      const msgId = msg.id ?? `line-${seq}`
      if (!msgUsage.has(msgId)) msgOrder.push(msgId)
      if (msg.usage) msgUsage.set(msgId, msg.usage)
      for (const block of Array.isArray(msg.content) ? msg.content : []) {
        if (block?.type === 'tool_use') {
          if (calls.has(block.id)) continue
          const call = { id: block.id, name: block.name, input: block.input ?? {}, ts, seq, msgId, result: null }
          calls.set(block.id, call)
          msgHasTool.add(msgId)
          events.push({ ts, seq, kind: 'call', callId: block.id, msgId })
          if (block.name === 'Skill') skillInvoked = true
        } else if (block?.type === 'text' && block.text?.trim()) {
          events.push({ ts, seq, kind: 'text', msgId, text: block.text })
          lastAssistantText = block.text
        } else if (block?.type === 'thinking' || block?.type === 'redacted_thinking') {
          events.push({ ts, seq, kind: 'thinking', msgId })
        }
      }
    } else {
      // user: tool results, the initial prompt, or skill injections.
      const content = msg.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result') {
            const call = calls.get(block.tool_use_id)
            const text = resultText(block.content)
            const tur = obj.toolUseResult ?? obj.tool_use_result
            const res = { ts, text, isError: !!block.is_error, stdout: tur?.stdout, stderr: tur?.stderr }
            if (call && !call.result) call.result = res
            events.push({ ts, seq, kind: 'result', callId: block.tool_use_id })
          } else if (block?.type === 'text' && /^Base directory for this skill:/.test(block.text ?? '')) {
            skillInjectedBytes += Buffer.byteLength(block.text)
          }
        }
      }
    }
  }

  events.sort((a, b) => a.ts - b.ts || a.seq - b.seq)
  for (const e of events) if (e.kind === 'text' || e.kind === 'thinking') e.msgHasTool = msgHasTool.has(e.msgId)

  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, messages: msgOrder.length, peakContext: 0 }
  for (const id of msgOrder) {
    const u = msgUsage.get(id)
    if (!u) continue
    usage.input += u.input_tokens ?? 0
    usage.output += u.output_tokens ?? 0
    usage.cacheRead += u.cache_read_input_tokens ?? 0
    usage.cacheCreation += u.cache_creation_input_tokens ?? 0
    const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0)
    if (ctx > usage.peakContext) usage.peakContext = ctx
  }
  usage.total = usage.input + usage.output + usage.cacheRead + usage.cacheCreation

  const callList = [...calls.values()].sort((a, b) => a.ts - b.ts || a.seq - b.seq)
  const handback = [...callList].reverse().find((c) => c.name === 'SubagentHandback')
  const finalReport = handback ? String(handback.input.message ?? '') : lastAssistantText ?? (typeof result?.result === 'string' ? result.result : '')

  let headless = null
  if (init || result) {
    const u = result?.usage ?? {}
    headless = {
      model: init?.model ?? null,
      costUsd: result?.total_cost_usd ?? null,
      durationMs: result?.duration_ms ?? null,
      tokens: result ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : null,
      outputTokens: result ? u.output_tokens ?? 0 : null,
      numTurns: result?.num_turns ?? null,
      isError: result ? !!result.is_error : null,
    }
  }

  return { firstTs, lastTs, calls: callList, events, usage, finalReport, skillInvoked, skillInjectedBytes, headless }
}
