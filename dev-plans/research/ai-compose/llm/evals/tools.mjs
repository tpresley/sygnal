#!/usr/bin/env node
// Agent-in-a-chat path: the layout arrives as tool-call arguments (ask_user) mid-conversation.
//   node evals/tools.mjs [--models qwen3:8b] [--so]   (--so also runs the structured-output encoding on the should-call scenarios)
// Scores: called when it should / not when it shouldn't, args valid against the schema as emitted,
// args valid after repair, fit of the parts (allowed set + one needed part + text needles).
import { appendFileSync, mkdirSync } from 'node:fs'
import { layoutSchema, systemPrompt, catalogText, checkSchema, readLayout, layoutToString, normalizeCatalog } from '../llm-composer.mjs'
import { INTERACT, SCENARIOS, fit } from './tools-data.mjs'

const SYSTEM = `You are the assistant of a personal-errands app. You can do things for the user (bookings, reminders, files, orders).
When you need something from the user before you can continue (a choice, a missing detail, a confirmation before an irreversible action, feedback), call the ask_user tool: it shows UI in the chat and returns the user's answer. Ask only for what you need. Do not call it for questions you can answer yourself or when the user has already given what you need.`

const TOOL_DESCRIPTION = `Show UI in the chat to ask the user something; their answer comes back as the result. The UI is a list of parts, top to bottom (children). ${catalogText(INTERACT)}`

const args = process.argv.slice(2)
const models = (args.includes('--models') ? args[args.indexOf('--models') + 1] : 'qwen3:8b').split(',')
const OLLAMA = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
const schema = layoutSchema(INTERACT, 'tree')
// 'simple': no $ref/anyOf (tool schemas are rendered into the prompt as text, not enforced)
const simple = { type: 'object', properties: { children: { type: 'array', description: 'the parts, top to bottom', items: { type: 'object', properties: { part: { enum: normalizeCatalog(INTERACT).parts.map((p) => p.id) }, params: { type: 'object', description: "the part's params (see the tool description)" } }, required: ['part'] } } }, required: ['children'] }
const variants = (args.includes('--variants') ? args[args.indexOf('--variants') + 1] : 'tree,simple').split(',')
mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
const out = new URL('./results/tools.jsonl', import.meta.url)

async function chatApi(body) {
  const t = performance.now()
  const j = await (await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify({ stream: false, think: false, options: { temperature: 0, num_ctx: 8192 }, ...body }) })).json()
  if (j.error) throw new Error(j.error)
  return { ...j, ms: Math.round(performance.now() - t) }
}

const INTENT_TOOL = { type: 'function', function: { name: 'ask_user', description: 'Show UI in the chat to ask the user something (a choice, a missing detail, a confirmation, feedback); their answer comes back as the result.', parameters: { type: 'object', properties: { need: { type: 'string', description: 'what you need from the user, in a sentence, with the options or details from the conversation' } }, required: ['need'] } } }
const SO_SYSTEM = () => systemPrompt(INTERACT, 'tree').replace('You compose a page of an app from parts the app has prepared. Each part already has its own data and wording; you only choose which parts the request asks for and arrange them.', "You compose the UI an assistant shows in a chat to ask the user for something. Use the parts that ask for exactly what the request needs; fill the parts' params from the request.")
  .replace('- Use only the parts the request asks for, by name or by what they show. Include every part it asks for. Do not add parts it does not ask for, even related ones.\n', '')
  .replace('- Order the parts top to bottom as the request says (first, at the top, above, then, below, under, at the bottom). When it does not say, keep the order in which the request mentions them.\n', '')

for (const model of models) for (const variant of variants) {
  const tool = variant === 'intent' ? INTENT_TOOL : { type: 'function', function: { name: 'ask_user', description: TOOL_DESCRIPTION, parameters: variant === 'simple' ? simple : schema } }
  const rows = []
  for (const s of SCENARIOS) {
    const j = await chatApi({ model, tools: [tool], messages: [{ role: 'system', content: SYSTEM }, ...s.messages] })
    const tc = j.message.tool_calls?.find((c) => c.function?.name === 'ask_user')
    let argsRaw = tc?.function?.arguments
    if (typeof argsRaw === 'string') try { argsRaw = JSON.parse(argsRaw) } catch {}
    const called = !!tc
    const callOk = s.call === 'either' ? true : called === s.call
    let composeMs = 0
    if (called && variant === 'intent') {
      // second step: the need → the UI, with the layout schema enforced (structured output)
      const need = typeof argsRaw?.need === 'string' ? argsRaw.need : JSON.stringify(argsRaw)
      const j2 = await chatApi({ model, format: schema, messages: [{ role: 'system', content: SO_SYSTEM() }, { role: 'user', content: need }] })
      composeMs = j2.ms
      try { argsRaw = { need, ...JSON.parse(j2.message.content) } } catch { argsRaw = { need } }
    }
    const checked = variant === 'intent' && argsRaw ? Object.fromEntries(Object.entries(argsRaw).filter(([k]) => k !== 'need')) : argsRaw
    const errs = called ? checkSchema(schema, checked) : []
    const { layout, issues } = called ? readLayout(INTERACT, 'tree', checked) : { layout: null, issues: [] }
    const fitOk = called && s.call !== false ? fit(s, layout) : null
    const r = { model, id: s.id, issues: issues.map((i) => i.kind), expect: s.call, called, callOk, valid: called ? errs.length === 0 : null, errs: errs.slice(0, 4), repairedOk: called ? Object.keys(layout.nodes).length > 1 : null, fit: fitOk, got: layout ? layoutToString(layout) : null, params: layout && Object.values(layout.nodes).map((n) => n.params).filter(Boolean), text: j.message.content?.slice(0, 160), ms: j.ms + composeMs }
    rows.push(r)
    appendFileSync(out, JSON.stringify({ mode: `tool-${variant}`, ...r, args: argsRaw }) + '\n')
    console.error(`${variant} ${callOk ? 'ok  ' : 'MISS'} ${s.id} expect ${s.call} called ${called}${called ? ` valid ${r.valid} fit ${fitOk}  ${r.got} ${JSON.stringify(r.params)}${errs.length ? `  errs: ${errs.slice(0, 3).join('; ')}` : ''}` : `  text: ${r.text}`}  ${j.ms + composeMs} ms`)
  }
  const should = rows.filter((r) => SCENARIOS.find((s) => s.id === r.id).call === true)
  const shouldNot = rows.filter((r) => SCENARIOS.find((s) => s.id === r.id).call === false)
  const calledRows = rows.filter((r) => r.called)
  const ms = rows.map((r) => r.ms).sort((x, y) => x - y)
  console.log(`| ${model} tool call (${variant} schema) | ${should.filter((r) => r.called).length}/${should.length} | ${shouldNot.filter((r) => !r.called).length}/${shouldNot.length} | ${calledRows.filter((r) => r.valid).length}/${calledRows.length} | ${should.filter((r) => r.fit).length}/${should.length} | ${ms[ms.length >> 1]} |`)

  if (args.includes('--so') && variant === variants[0]) {
    // the same should-call scenarios through structured output: the conversation, then "compose the UI"
    const soRows = []
    for (const s of SCENARIOS.filter((x) => x.call === true)) {
      const convo = s.messages.map((m) => `${m.role}: ${m.content || JSON.stringify(m.tool_calls)}`).join('\n')
      const sys = systemPrompt(INTERACT, 'tree').replace('You compose a page of an app from parts the app has prepared. Each part already has its own data and wording; you only choose which parts the request asks for and arrange them.', 'You compose the UI an assistant shows in a chat to ask the user what it needs next. Fill the parts\' params from the conversation.')
      const j = await chatApi({ model, format: schema, messages: [{ role: 'system', content: sys }, { role: 'user', content: `Conversation so far:\n${convo}\n\nCompose the UI that asks the user what the assistant needs next.` }] })
      let v; try { v = JSON.parse(j.message.content) } catch {}
      const errs = v ? checkSchema(schema, v) : ['unparseable']
      const { layout } = readLayout(INTERACT, 'tree', v || {})
      const f = fit(s, layout)
      soRows.push({ f, valid: errs.length === 0, ms: j.ms })
      appendFileSync(out, JSON.stringify({ mode: 'structured', model, id: s.id, valid: errs.length === 0, errs, fit: f, got: layoutToString(layout), params: Object.values(layout.nodes).map((n) => n.params).filter(Boolean), ms: j.ms }) + '\n')
      console.error(`SO ${s.id} valid ${errs.length === 0} fit ${f}  ${layoutToString(layout)} ${JSON.stringify(Object.values(layout.nodes).map((n) => n.params).filter(Boolean))}  ${j.ms} ms`)
    }
    const m2 = soRows.map((r) => r.ms).sort((x, y) => x - y)
    console.log(`| ${model} structured output (should-call only) | - | - | ${soRows.filter((r) => r.valid).length}/${soRows.length} | ${soRows.filter((r) => r.f).length}/${soRows.length} | ${m2[m2.length >> 1]} |`)
  }
}
