#!/usr/bin/env node
// node evals/run.mjs --set base|ext|edits --models qwen3:8b,llama3.2:latest --enc tree,blocks,flat,two
//   [--edit whole,ops] [--shots 0|1] [--mode schema|json|none] [--think] [--tag name]
// Runs sequentially on local Ollama (/api/chat), prints a score table, appends rows to evals/results/<tag>.jsonl.
import { appendFileSync, mkdirSync } from 'node:fs'
import { BASE, EXT, BASE_CASES, BASE_SHOTS, OPS_SHOTS, EXT_CASES, EDIT_CASES } from './cases.mjs'
import { composeRequest, secondStep, editRequest, readComposition, readOps, parseReply } from './requests.mjs'
import { scoreCase, summarize, printTable } from './score.mjs'
import { normalizeCatalog, autoShots } from '../llm-composer.mjs'
import { loadA1 } from './a1.mjs'
import { loadA2 } from './a2.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
  return acc
}, []))
const OLLAMA = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
const set = args.set || 'base'
const models = (args.models || 'qwen3:8b').split(',')
const encs = (args.enc || 'blocks').split(',')
const editModes = (args.edit || 'whole').split(',')
const mode = args.mode || 'schema'
const think = !!args.think
const shots = args.shots === '1' ? (set === 'a1-ops' ? OPS_SHOTS : BASE_SHOTS) : args.shots === 'auto' ? 'auto' : []
const only = args.only ? args.only.split(',') : null
const tag = args.tag || `${set}-${mode}${think ? '-think' : ''}${shots.length ? `-shots${shots === 'auto' ? '-auto' : ''}` : ''}`
mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
const out = new URL(`./results/${tag}.jsonl`, import.meta.url)

export async function chat(model, { system, messages, schema }) {
  const started = performance.now()
  const body = {
    model, stream: false, think, keep_alive: '10m',
    options: { temperature: 0, num_ctx: 8192 },
    messages: [{ role: 'system', content: system }, ...messages],
    ...(mode === 'schema' && { format: schema }), ...(mode === 'json' && { format: 'json' }),
  }
  const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify(body) })
  const j = await res.json()
  if (j.error) throw new Error(j.error)
  return { text: j.message.content, ms: Math.round(performance.now() - started), evalCount: j.eval_count, promptCount: j.prompt_eval_count, thinking: j.message.thinking?.length || 0 }
}

const a1 = set.startsWith('a1-') ? await loadA1(set.slice(3)) : null
const a2 = set.startsWith('a2-') ? await loadA2(set.slice(3)) : null
const CATALOG = a1 ? a1.catalog : set === 'base' ? BASE : EXT
const isEdit = set === 'edits' || set === 'a2-edits'
const cases = (a2 || (a1 ? a1.cases : set === 'base' ? BASE_CASES : set === 'ext' ? EXT_CASES : EDIT_CASES)).filter((k) => !only || only.includes(k.id))
const table = []
for (const model of models) for (const enc of encs) for (const em of isEdit ? editModes : [null]) {
  const rows = []
  const name = `${model} ${enc}${em ? ` ${em}` : ''}${mode !== 'schema' ? ` (${mode})` : ''}${think ? ' think' : ''}${shots === 'auto' ? ' +autoshots' : shots.length ? ' +shots' : ''}`
  for (const k of cases) {
    const catalog = k.catalog || CATALOG
    let r, ms = 0, raw, tokens = 0
    try {
      if (isEdit) {
        const req = editRequest(catalog, enc, k.prev, k.prompt, em)
        const a = await chat(model, req); ms = a.ms; raw = a.text; tokens = a.evalCount
        r = em.startsWith('ops') ? readOps(catalog, req.prev, a.text, em) : readComposition(catalog, enc, a.text, { prev: req.prev })
        Object.assign(r, scoreCase(catalog, k, r.layout, { prev: req.prev }))
      } else if (enc === 'two') {
        const a = await chat(model, composeRequest(catalog, 'two', k.prompt)); ms = a.ms; raw = a.text; tokens = a.evalCount
        const ids = [...new Set((parseReply(a.text).value?.parts || []).filter((id) => normalizeCatalog(catalog).byId[id]))]
        if (ids.length === 0) r = readComposition(catalog, 'blocks', '{"blocks":[]}')
        else if (ids.length === 1) r = readComposition(catalog, 'blocks', JSON.stringify({ blocks: ids }))
        else {
          const b = await chat(model, secondStep(catalog, k.prompt, ids)); ms += b.ms; raw += '\n' + b.text; tokens += b.evalCount
          const v = parseReply(b.text).value || { blocks: [] }
          // a selected part the arrangement left out goes at the end
          const seen = JSON.stringify(v.blocks)
          for (const id of ids) if (!seen.includes(`"${id}"`)) v.blocks.push(id)
          r = readComposition(catalog, 'blocks', JSON.stringify(v))
        }
        Object.assign(r, scoreCase(catalog, k, r.layout))
      } else {
        const a = await chat(model, composeRequest(catalog, enc, k.prompt, { shots: shots === 'auto' ? autoShots(catalog) : shots })); ms = a.ms; raw = a.text; tokens = a.evalCount
        r = readComposition(catalog, enc, a.text)
        Object.assign(r, scoreCase(catalog, k, r.layout))
      }
    } catch (e) {
      r = { invalid: 1, exact: false, partErrors: 0, error: String(e.message || e).slice(0, 200), issues: [] }
    }
    r.ms = ms
    r.tokens = tokens
    rows.push(r)
    appendFileSync(out, JSON.stringify({ config: name, id: k.id, prompt: k.prompt, want: r.want, got: r.got, exact: r.exact, partErrors: r.partErrors, paramErrors: r.paramErrors, structureError: r.structureError, textOk: r.textOk, keyKept: r.keyKept, invalid: r.invalid, issues: r.issues, ms, tokens, raw, error: r.error, layout: r.layout }) + '\n')
    console.error(`${r.exact ? 'ok  ' : 'MISS'} ${name} ${k.id} ${k.prompt}\n     got ${r.got ?? r.error}${r.exact ? '' : `  (want ${r.want})`}${r.textOk === false ? '  TEXT✗' : ''}${r.keyKept === false ? '  KEYS✗' : ''}${r.issues?.length ? `  repairs: ${r.issues.map((i) => i.kind).join(',')}` : ''}  ${ms} ms`)
  }
  table.push([name, summarize(rows)])
}
console.log(`\n${set} set, ${cases.length} cases, mode ${mode}`)
printTable(table)
