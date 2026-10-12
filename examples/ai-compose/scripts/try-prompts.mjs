#!/usr/bin/env node
// npm run try [-- "a prompt" ...]: compose prompts with a decision model and print the layouts. With
// no prompts, runs the labelled cases below and scores them (exact layout, wrong or missing parts).
// The same requests the app sends (src/compose.js), without the browser.
//
//   npm run try                                    local Ollama, MODEL=nimble (OLLAMA_URL=...)
//   node --env-file=$HOME/.config/typesafe/env scripts/try-prompts.mjs
//                                                  TypeSafe (TYPESAFE_API_KEY; MODEL=jev-latest);
//                                                  the key only goes in the Authorization header
import { PARTS } from '../src/parts.js'
import { selectRequest, layoutRequest, readSelection, readLayout } from '../src/compose.js'

// prompt → the expected layout, top to bottom ('row(a,b)': side by side; '': nothing fits)
const CASES = [
  ['Sales overview: revenue, signups and churn side by side, then the revenue chart', 'row(revenue,signups,churn) revenueChart'],
  ['My morning: the weather and my tasks for today', 'weather tasks'],
  ['Support desk: open tickets first, then recent orders', 'tickets orders'],
  ['A feedback form at the top, and the open tickets below it', 'feedback tickets'],
  ['Show me the stock price of Apple', ''],
  ['Put my tasks beside the weather, and a feedback form under them', 'row(tasks,weather) feedback'],
  ['Recent orders, the revenue chart, and below that a feedback form', 'orders revenueChart feedback'],
  ['The revenue chart, with the orders table above it and the tickets at the very bottom', 'orders revenueChart tickets'],
  ['How are sales doing?', 'revenue revenueChart'],
  ['What is on my plate today?', 'tasks'],
  ['Churn and signups next to each other', 'row(churn,signups)'],
]

const key = process.env.TYPESAFE_API_KEY
const base = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
const url = key ? 'https://api.typesafe.ai/v1/systemone' : `${base}/v1/systemone`
const model = process.env.MODEL || (key ? 'jev-latest' : 'nimble')
const headers = { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) }

async function send(request) {
  const started = performance.now()
  const res = await fetch(request.url, { method: 'POST', headers, body: JSON.stringify(request.json) })
  if (!res.ok) throw new Error(`${request.url}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`)
  return { ...(await res.json()), ms: Math.round(performance.now() - started) }
}

/** prompt → { layout: 'a row(b,c)', ms: [select, layout?] } */
async function compose(prompt) {
  const picked = await send(selectRequest({ url, model, prompt, parts: PARTS }))
  const selection = readSelection(PARTS, picked.answers)
  if (selection.ids.length < 2) return { layout: selection.ids.join(' '), ms: [picked.ms] }
  const arranged = await send(layoutRequest({ url, model, prompt, parts: PARTS, selection }))
  const blocks = readLayout(selection, arranged.answers)
  return { layout: blocks.map((b) => (b.row ? `row(${b.row})` : b.id)).join(' '), ms: [picked.ms, arranged.ms] }
}

const parts = (layout) => layout.match(/[A-Za-z]+/g)?.filter((w) => w !== 'row') || []
const prompts = process.argv.slice(2)
console.log(`${model} at ${url}\n`)

if (prompts.length) {
  for (const prompt of prompts) {
    const { layout, ms } = await compose(prompt)
    console.log(`${prompt}\n  ${layout || '(nothing fits)'}   ${ms.join(' + ')} ms`)
  }
} else {
  let exact = 0
  let partErrors = 0
  const times = []
  for (const [prompt, want] of CASES) {
    const { layout, ms } = await compose(prompt)
    times.push(ms.reduce((a, b) => a + b, 0))
    const got = parts(layout)
    partErrors += parts(want).filter((p) => !got.includes(p)).length + got.filter((p) => !parts(want).includes(p)).length
    if (layout === want) exact++
    console.log(`${layout === want ? 'ok  ' : 'MISS'} ${prompt}\n     ${layout || '(nothing fits)'}${layout === want ? '' : `   (want ${want || 'nothing'})`}   ${ms.join(' + ')} ms`)
  }
  times.sort((a, b) => a - b)
  console.log(`\n${exact}/${CASES.length} exact layouts, ${partErrors} wrong or missing parts, median ${times[times.length >> 1]} ms per composition`)
}
