#!/usr/bin/env node
// Runner: node --env-file=$HOME/.config/typesafe/env evals/run.mjs <params|records|edits|all> [strategy,...]
//         MODEL=nimble node evals/run.mjs ...      (local Ollama)
// VERBOSE=1 prints every case. Prints exact-match, errors, calls, tokens, median latency per strategy.
import { decideRaw, MODEL, median } from './client.mjs'
import * as L from '../params-edits.mjs'
import { PARAM_CASES, RECORD_CASES, EDIT_CASES, EDIT_HELDOUT, PM40, PM200 } from './cases.mjs'
import { baselineEdit } from './baseline-edit.mjs'

const [section = 'all', only] = process.argv.slice(2)
const pick = (list) => (only ? list.filter((s) => only.split(',').includes(s.name)) : list)
const V = !!process.env.VERBOSE
const REPEAT = Number(process.env.REPEAT || 1)
L.LIMITS.maxOptions = Number(process.env.MAX_OPTIONS || (MODEL === 'nimble' ? 26 : 255)) // Ollama: 2–26 candidates per choice
const rep = (list) => Array.from({ length: REPEAT }, () => list).flat()

/** a measured decide: counts calls, tokens, ms for one case */
function meter() {
  const m = { calls: 0, tokens: 0, ms: 0 }
  const decide = async (state, questions) => {
    if (!Object.keys(questions).length) return { answers: {} }
    const r = await decideRaw(state, questions)
    m.calls++; m.tokens += r.usage?.input_tokens ?? 0; m.ms += r.ms
    return r
  }
  return { m, decide }
}
const sigNodes = (nodes) => nodes.map((n) => L.signature(L.layoutOf([n]))).sort().join(' ')
function report(name, rows) {
  const n = rows.length
  const ok = rows.filter((r) => r.ok).length
  const extra = rows[0]?.parts !== undefined ? ` | parts+params ${rows.filter((r) => r.parts).length}/${n}` : ''
  const keys = rows[0]?.keyErrors !== undefined ? ` | key errors ${rows.reduce((a, r) => a + r.keyErrors, 0)}` : ''
  console.log(`${MODEL.padEnd(6)} ${name.padEnd(22)} exact ${ok}/${n}${extra}${keys} | calls/case ${(rows.reduce((a, r) => a + r.m.calls, 0) / n).toFixed(2)} | tokens/case ${Math.round(rows.reduce((a, r) => a + r.m.tokens, 0) / n)} | median ${median(rows.map((r) => r.m.ms))} ms`)
  for (const r of rows) if (!r.ok || V) console.log(`    ${r.ok ? 'ok  ' : 'MISS'} ${r.prompt}\n         got  ${r.got || '(nothing)'}\n         want ${r.want || '(nothing)'}`)
}

// ---------- params ----------
const PARAM_STRATEGIES = [
  { name: 'inline+notStated', params: 'inline', paramMode: 'notStated' },
  { name: 'separate+notStated', params: 'separate', paramMode: 'notStated' },
  { name: 'separate+threshold', params: 'separate', paramMode: 'threshold', threshold: 0.6 },
  { name: 'inline+threshold', params: 'inline', paramMode: 'threshold', threshold: 0.6 },
]
async function composeFresh(decide, catalog, prompt, s) {
  const state = { user_request: prompt }
  const a1 = await decide(state, L.selectQuestions(catalog, s))
  let sel = L.readSelection(catalog, a1.answers, s)
  if (sel.needsRecords.length) {
    const a = await decide(state, L.recordQuestions(catalog, sel.needsRecords, s))
    sel = L.readSelection(catalog, a1.answers, { ...s, recordAnswers: a.answers })
  }
  let nodes = sel.nodes
  if (s.params === 'separate') {
    const qs = L.configureQuestions(catalog, nodes, s)
    if (Object.keys(qs).length) nodes = L.applyConfigure(catalog, nodes, (await decide(state, qs)).answers, s)
  }
  if (s.noOrder) return { nodes }
  if (nodes.length < 2) return { nodes, layout: L.layoutOf(nodes) }
  const a3 = await decide({ user_request: prompt }, L.orderQuestions(catalog, nodes, sel))
  return { nodes, layout: L.readOrder(catalog, nodes, a3.answers, sel) }
}
async function runParams() {
  for (const s of pick(PARAM_STRATEGIES)) {
    const rows = []
    for (const [catalog, prompt, want] of rep(PARAM_CASES)) {
      const { m, decide } = meter()
      const { nodes, layout } = await composeFresh(decide, catalog, prompt, s)
      const wantL = L.layoutOf(want)
      const got = L.signature(layout)
      rows.push({ prompt, m, ok: got === L.signature(wantL), parts: sigNodes(nodes) === sigNodes(L.leaves(wantL).map((l) => l.node)), got, want: L.signature(wantL) })
    }
    report(s.name, rows)
  }
}

// ---------- records ----------
const RECORD_STRATEGIES = [
  { name: 'perRecord', records: 'perRecord' },
  { name: 'noul', records: 'noul' },
  { name: 'pick', records: 'pick', pickThreshold: 0.2 },
  { name: 'gated-noul', records: 'gated', ask: 'noul' },
  { name: 'gated-choice', records: 'gated', ask: 'choice' },
  { name: 'gated-slots', records: 'gated', ask: 'slots' },
  { name: 'slots', records: 'slots' },
  { name: 'groups+gated-slots', records: 'gated', ask: 'slots', groups: true },
  { name: 'groups+slots', records: 'slots', groups: true },
  { name: 'groups+gated-slots-nonames', records: 'gated', ask: 'slots', groups: true, familyNames: false },
  { name: 'groups+slots2', records: 'slots', groups: true, slots: 2 },
  { name: 'prefilter+groups+slots', records: 'slots', groups: true, prefilter: true, atLeastOne: true },
  { name: 'prefilter+groups+gated-slots', records: 'gated', ask: 'slots', groups: true, prefilter: true, atLeastOne: true },
  { name: 'groups+gated-choice', records: 'gated', ask: 'choice', groups: true },
]
async function runRecords() {
  const scales = process.env.SCALES ? process.env.SCALES.split(',') : ['40', '200']
  for (const scale of scales) {
    const catalog = scale === '200' ? PM200 : PM40
    for (const s0 of pick(RECORD_STRATEGIES)) {
      const s = { ...s0, params: 'inline', paramMode: 'notStated', noOrder: true }
      const rows = []
      for (const [prompt, wantFn] of rep(RECORD_CASES)) {
        const { m, decide } = meter()
        const want = wantFn(catalog).map((b) => (typeof b === 'string' ? { part: b, params: {} } : b))
        const { nodes } = await composeFresh(decide, s.prefilter ? L.narrowRecords(catalog, prompt) : catalog, prompt, s)
        const got = sigNodes(nodes); const w = sigNodes(want)
        rows.push({ prompt, m, ok: got === w, got, want: w })
      }
      report(`${s.name}@${scale}`, rows)
    }
  }
}

// ---------- edits ----------
// identity of a node across an edit: its part, plus its record for record parts (params may change)
const ident = (n) => n.part + (n.params?.project ?? n.params?.member ?? n.params?.report ?? '')
function keyErrors(prev, next) {
  const before = new Map(L.leaves(prev).map((l) => [ident(l.node), l.key]))
  return L.leaves(next).filter((l) => before.has(ident(l.node)) && before.get(ident(l.node)) !== l.key).length
}
function simplerOk(prev, next) {
  const a = L.leaves(prev).map((l) => l.key); const b = L.leaves(next).map((l) => l.key)
  return b.length > 0 && b.length < a.length && b.every((k, i) => i === 0 || a.indexOf(k) > a.indexOf(b[i - 1])) && b.every((k) => a.includes(k))
}
const batch = (where, simplify = true, placeGate = true, narrow = true, extra = { moveSlots: 0, changeGate: false }) => async (decide, catalog, layout, prompt) => {
  const state = L.editState(catalog, layout, prompt)
  const a1 = await decide(state, L.editQuestions(catalog, layout, { simplify, placeGate, prompt: narrow ? prompt : null, ...extra }))
  const plan = L.readEdit(catalog, layout, a1.answers, { simplify, placeGate, atLeastOne: narrow, ...extra })
  const qs = where ? L.editWhereQuestions(catalog, layout, plan) : L.editPlaceQuestionsPairwise(catalog, layout, plan)
  const a2 = Object.keys(qs).length ? await decide(state, qs) : { answers: {} }
  return (where ? L.applyEdit : L.applyEditPairwise)(catalog, layout, plan, a2.answers)
}
const EDIT_STRATEGIES = [
  { name: 'batch+where', run: batch(true) },
  { name: 'batch+where-nogate', run: batch(true, true, false) },
  { name: 'batch+where+changegate', run: batch(true, true, true, true, { changeGate: true }) },
  { name: 'batch+where+moveslots', run: batch(true, true, true, true, { changeGate: true, moveSlots: 2 }) },
  { name: 'batch+pairwise', run: batch(false) },
  { name: 'batch+where-nosimplify', run: batch(true, false) },
  { name: 'sequential(json-render)', async run(decide, catalog, layout, prompt) { return (await baselineEdit(decide, catalog, layout, prompt)).layout } },
]
async function runEdits() {
  const sets = process.env.EDITS === 'heldout' ? [['heldout', EDIT_HELDOUT]] : process.env.EDITS === 'tuned' ? [['tuned', EDIT_CASES]] : [['tuned', EDIT_CASES], ['heldout', EDIT_HELDOUT]]
  for (const [setName, CASES] of sets) for (const s of pick(EDIT_STRATEGIES)) {
    const rows = []
    for (const [catalog, prev, prompt, want, accept] of rep(CASES)) {
      const { m, decide } = meter()
      const layout = L.layoutOf(prev)
      const out = await s.run(decide, catalog, layout, prompt)
      const got = L.signature(out)
      const ok = accept === 'simpler' ? simplerOk(layout, out) : got === L.signature(L.layoutOf(want))
      rows.push({ prompt, m, ok, keyErrors: keyErrors(layout, out), got, want: accept === 'simpler' ? '(any shorter page, same order)' : L.signature(L.layoutOf(want)) })
    }
    report(`${s.name}@${setName}`, rows)
  }
}

if (section === 'params' || section === 'all') await runParams()
if (section === 'records' || section === 'all') await runRecords()
if (section === 'edits' || section === 'all') await runEdits()
