#!/usr/bin/env node
// Each diagnostic the context mentions: does its own message already tell an agent what to do when
// it fires, so the sentence can go? Verdicts are by hand from the message and fix text at the
// report site and sygnal-check/explanations.json. `go`: the sentence can go, the message names
// the fix and fires in the normal loop (npm test with strict + expectNoDiagnostics, or
// sygnal-check --strict). `short`: keep the positive form (an example shows it), drop the "never".
// `keep`: needed before the first line, or doesn't fire in the normal loop. Bytes are the
// sentences that name the code in each file.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paragraphs, sentences } from './audit.mjs'
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const ex = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(repo, 'sygnal-check/explanations.json'), 'utf8')).map((e) => [e.code, e]))

// verdict, note, 8.0 candidate (or null)
const V = {
  SYG101: ['go', 'Names the action and the two fixes; the anatomy shows the pairing', 'Throw at definition in dev (an action with no reducer is never intended)'],
  SYG102: ['go', 'info: the message suggests the fix', null],
  SYG104: ['keep', 'Message is complete, but it decides where events are handled; one sentence in the model. The bubbling detail can go', null],
  SYG105: ['go', 'info only, so `expectNoDiagnostics` misses it: a typo in an event name runs silently', 'Raise to warn: an emitted or selected name with no partner is a bug, and the name registry makes it checkable'],
  SYG106: ['go', 'Names the prop and the rename', 'Error in dev, as strict mode already makes it'],
  SYG110: ['go', 'Static', null],
  SYG111: ['short', 'Example comment carries it; the React habit (`value` + `onChange`) makes it likely', null],
  SYG112: ['go', 'Names the closest entry', null],
  SYG115: ['go', 'Fix names the real event', 'Throw in dev: `DOM.enter` can never mean anything'],
  SYG116: ['go', 'Fix shows the form', 'Make it impossible: a sink function returning an `event()` result is unambiguous, so accept it'],
  SYG117: ['go', 'Names the ancestor that handles it', null],
  SYG118: ['go', 'Behavior-only', null],
  SYG127: ['go', 'Error, names the key', null],
  SYG130: ['go', 'Names the closest route', null],
  SYG132: ['go', 'Fix is one word', 'Make it impossible: a root that declares `route`, `head`, … and has no `initialState` starts from `{}`'],
  SYG140: ['go', 'Names the fix', null],
  SYG143: ['go', 'Fix shows the class form', 'Make it impossible: `DOM.select(Widget)` resolves to the widget host (controls() already has the machinery)'],
  SYG202: ['go', 'Warn; "no change" is shown in every example', 'Decide: treat `undefined` from a root reducer as ABORT, or throw'],
  SYG214: ['go', 'It reports the thrown error; nothing to learn before it', null],
  SYG221: ['go', 'Error, and the message writes the exact replacement', 'Make it work: `set(\'draft\')` means "store the data here", which is what every agent who wrote it meant; or throw at definition, in production too'],
  SYG222: ['short', 'Positive form ("return a new object") stays; a React habit', 'Throw in dev by freezing the state handed to reducers'],
  SYG224: ['go', 'Error, says why', null],
  SYG230: ['go', 'Names the field and the fix', null],
  SYG237: ['go', 'Writes the fix', null],
  SYG256: ['keep', 'Static and only where provable; "guards read previousState" is the rule the model needs', null],
  SYG257: ['go', 'Audit mode, upgrade only: migration guide, not the core', null],
  SYG258: ['short', 'Keep the `{ now, uuid }` line (tests depend on it); `--fix` rewrites the rest', null],
  SYG301: ['go', 'Thrown, and it names the xstream form of 40 operators: the RxJS table (700 B) is a copy of the message', null],
  SYG302: ['short', 'info only; the example import is the fix', 'Make it work: the Vite plugin already resolves `xstream`, it can give a default export the shape the app expects'],
  SYG401: ['go', 'Fix shows the form', null],
  SYG402: ['go', 'Error', null],
  SYG405: ['keep', 'Thrown, but it decides where state lives: the most common React-shaped mistake. One clause in the model', null],
  SYG421: ['go', 'Writes the fix', 'Make it impossible: `data={{ \'task-id\': 1 }}` can be normalized to the camelCase key'],
  SYG425: ['go', 'Writes the fix', null],
  SYG429: ['go', 'Names the page', null],
  SYG430: ['keep', 'Layout only: never fires in a mock-DOM test. It belongs in the topic file, not the core', null],
  SYG454: ['go', 'Sygnal 6 only: version note, migration guide', null],
  SYG501: ['go', 'Static, strict, removed form; nothing in training data teaches it', null],
  SYG503: ['go', 'Strict; `EFFECT` is shown', null],
  SYG504: ['go', 'Strict, removed form', null],
  SYG505: ['go', 'Strict; `event()` is shown', null],
  SYG506: ['go', 'Strict, removed form', null],
  SYG507: ['go', 'info, strict', null],
  SYG508: ['go', 'Strict; reply actions are the example', null],
  SYG509: ['go', 'Strict; `--fix`', null],
  SYG610: ['go', 'Error, request not sent; fix shows `ok` / `error`', null],
  SYG611: ['go', 'Error', null],
  SYG612: ['go', 'Error, names the guide section', null],
  SYG620: ['go', 'Error', null],
  SYG635: ['go', 'Writes the fix', null],
  SYG637: ['go', 'Static', null],
  SYG640: ['go', 'Says it found nothing in that view', null],
  SYG641: ['go', 'Error', null],
  SYG643: ['go', 'Fires for connections too: the core\'s "without it nothing reports it" is stale', 'Hand-off: the session on driver wiring owns this one'],
  SYG670: ['keep', 'Security, fires only in a browser against a hosted URL; stays in `llms/ai.md`', null],
  SYG691: ['go', 'Names the closest procedure', null],
}

const bytes = (s) => Buffer.byteLength(s)
function sentenceBytes(rel) {
  const out = {}
  for (const p of paragraphs(rel)) {
    if (p.code) continue
    for (const s of sentences(p.text)) for (const c of new Set(s.match(/SYG\d{3}/g) ?? [])) out[c] = (out[c] ?? 0) + bytes(s)
  }
  return out
}
const L = sentenceBytes('llms.txt'), S = sentenceBytes('skills/sygnal-dev/SKILL.md')
const codes = Object.keys(V).sort()
const missing = [...new Set([...Object.keys(L), ...Object.keys(S)])].filter((c) => !V[c])
if (missing.length) console.error('no verdict for', missing)
const sum = { go: [0, 0], short: [0, 0], keep: [0, 0] }
const lines = ['| Code | Severity | Reported by | Verdict | llms.txt B | SKILL B | Why |', '|---|---|---|---|---|---|---|']
for (const c of codes) {
  const [v, why] = V[c], e = ex[c]
  sum[v][0] += L[c] ?? 0; sum[v][1] += S[c] ?? 0
  lines.push(`| ${c} | ${e?.severity ?? '?'} | ${e?.reportedBy?.join(', ') ?? '?'} | ${v} | ${L[c] ?? 0} | ${S[c] ?? 0} | ${why} |`)
}
const e8 = codes.filter((c) => V[c][2]).map((c) => `- **${c}** (${ex[c]?.title}): ${V[c][2]}`)
fs.writeFileSync(path.join(here, '../data/traps.md'), lines.join('\n') + '\n')
fs.writeFileSync(path.join(here, '../data/traps-8.0.md'), e8.join('\n') + '\n')
console.log(sum, codes.length, 'codes,', e8.length, '8.0 candidates')
console.log(Object.entries(V).reduce((o, [, [v]]) => ({ ...o, [v]: (o[v] ?? 0) + 1 }), {}))
