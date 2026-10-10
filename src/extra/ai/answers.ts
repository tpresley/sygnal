/*
 * PLAN-6 M-2: decision reply fixtures for tests. `answers(questions, picks)` builds the reply a
 * decision model would send for `decide({ questions })` (the dictionary form), so a test writes
 * only what matters and the rest is filled in sensibly:
 *
 *   await t.respond('HTTP', answers(questions, { topic: 'billing', urgent: true }), 'TRIAGED')
 *   await t.respond('HTTP', answers(questions, { topic: { choice: 'billing', confidence: 0.35 } }), 'TRIAGED')
 *
 * Picks per question type (an unknown question name or option throws, as a typo would otherwise
 * pass silently):
 * - choice: an option name, `{ choice?, confidence? }` or `{ probabilities }` (choice: the most
 *   likely). Default: the first option at confidence 0.9. The other options share the rest equally;
 * - noul: `true` (0.95), `false` (0.05) or the probability; default false;
 * - score: a level index (fractional: between two levels) or a level description, or
 *   `{ score, confidence? }`; default 0. The probabilities sit on the level(s) around it, so the
 *   weighted index is the score.
 * `confidence` is what TypeSafe / Ollama `nimble` report: 1 minus the probabilities' entropy over
 * its maximum (ln n), so 0 is "all options equally likely" and 1 is "certain" (a given confidence
 * is reached by choosing the winner's probability).
 *
 * `answers.openai(questions, picks)` is the same reply in OpenAI Decisions' array form, for a
 * `decide.openai()` request (its `parse` maps it back). Side-effect free.
 */

const conf = (ps: number[]) => {
  const n = ps.length
  if (n < 2) return 1
  let h = 0
  for (const p of ps) if (p > 0) h -= p * Math.log(p)
  return Math.max(0, Math.min(1, 1 - h / Math.log(n)))
}
/** the winner's probability that gives confidence `c` (the others share the rest) */
const winner = (n: number, c: number) => {
  if (n < 2) return 1
  let lo = 1 / n, hi = 1
  for (let i = 0; i < 60; i++) {
    const p = (lo + hi) / 2
    conf([p, ...Array(n - 1).fill((1 - p) / (n - 1))]) < c ? lo = p : hi = p
  }
  return (lo + hi) / 2
}
const isObj = (x: any) => !!x && typeof x == 'object' && !Array.isArray(x)
const bad = (name: string, msg: string): never => { throw new Error(`[Sygnal] answers(): ${name}: ${msg}`) }

function choiceAnswer(name: string, q: any, pick: any) {
  const opts = Object.keys(q.criteria || {})
  if (!opts.length) bad(name, 'the choice has no options')
  const check = (o: any) => opts.includes(String(o)) ? String(o) : bad(name, `${JSON.stringify(o)} is not an option (${opts.join(', ')})`)
  let probabilities: Record<string, number>, choice: string
  if (isObj(pick) && pick.probabilities) {
    const given = pick.probabilities
    Object.keys(given).forEach(check)
    const sum = Object.values(given).reduce((a: number, b: any) => a + b, 0)
    const left = opts.filter(o => !(o in given)), rest = Math.max(0, 1 - sum) / (left.length || 1)
    probabilities = Object.fromEntries(opts.map(o => [o, o in given ? given[o] : rest]))
    choice = pick.choice != null ? check(pick.choice) : opts.reduce((a, b) => probabilities[b] > probabilities[a] ? b : a)
  } else {
    choice = check(isObj(pick) ? pick.choice ?? opts[0] : pick ?? opts[0])
    const c = isObj(pick) && typeof pick.confidence == 'number' ? pick.confidence : 0.9
    const p = winner(opts.length, c)
    probabilities = Object.fromEntries(opts.map(o => [o, o === choice ? p : (1 - p) / (opts.length - 1)]))
  }
  const confidence = isObj(pick) && typeof pick.confidence == 'number' ? pick.confidence : conf(Object.values(probabilities))
  return {type: 'choice', choice, probabilities, confidence}
}

function scoreAnswer(name: string, q: any, pick: any) {
  const levels: string[] = q.criteria || [], n = levels.length
  if (n < 2) bad(name, 'a score needs 2 or more levels')
  const v = isObj(pick) ? pick.score : pick
  const x = v == null ? 0 : typeof v == 'string' ? (levels.indexOf(v) >= 0 ? levels.indexOf(v) : bad(name, `${JSON.stringify(v)} is not a level (${levels.join(', ')})`)) : v
  if (typeof x != 'number' || !(x >= 0 && x <= n - 1)) bad(name, `the score must be a level index from 0 to ${n - 1} or a level description`)
  const lo = Math.floor(x), f = x - lo, ps = levels.map((_, i) => i === lo ? 1 - f : i === lo + 1 ? f : 0)
  const probabilities = Object.fromEntries(ps.map((p, i) => [String(i), p]))
  const legend = Object.fromEntries(levels.map((l, i) => [String(i), l]))
  return {type: 'score', score: x, legend, probabilities, confidence: isObj(pick) && typeof pick.confidence == 'number' ? pick.confidence : conf(ps)}
}

function noulAnswer(name: string, pick: any) {
  const v = isObj(pick) ? pick.noul : pick
  const p = v == null || v === false ? 0.05 : v === true ? 0.95 : v
  if (typeof p != 'number' || !(p >= 0 && p <= 1)) bad(name, 'a noul pick is true, false or a probability from 0 to 1')
  return {type: 'noul', noul: p}
}

/** a decision reply (dictionary form) for `questions`, with `picks` by question name */
function dictionary(questions: any, picks: any = {}, options: any = {}) {
  const out: any = {}
  for (const name in picks) if (!(name in (questions || {}))) bad(name, `no such question (${Object.keys(questions || {}).join(', ')})`)
  for (const name in questions) {
    const q = questions[name], pick = picks[name]
    out[name] = q.type == 'choice' ? choiceAnswer(name, q, pick) : q.type == 'score' ? scoreAnswer(name, q, pick) : noulAnswer(name, pick)
  }
  return {model: options.model ?? 'test', answers: out, usage: options.usage ?? {input_tokens: 0, output_tokens: 0}}
}

const list = (m: Record<string, number>, legend?: Record<string, string>) =>
  Object.keys(m).map(k => legend ? {value: +k, label: legend[k], probability: m[k]} : {value: k, probability: m[k]})

/** the same reply in OpenAI Decisions' array form (for a `decide.openai()` request) */
function openai(questions: any, picks: any = {}, options: any = {}) {
  const d = dictionary(questions, picks, options)
  return {
    model: d.model,
    answers: Object.keys(d.answers).map(name => {
      const a = d.answers[name]
      return a.type == 'noul' ? {type: 'predicate', name, probability: a.noul}
        : a.type == 'choice' ? {type: 'choice', name, choice: a.choice, probabilities: list(a.probabilities), confidence: a.confidence}
        : {type: 'score', name, score: a.score, probabilities: list(a.probabilities, a.legend), confidence: a.confidence}
    }),
  }
}

// (an Object.assign marked pure, not `answers.openai = …`: bundlers keep a property assignment)
export const answers = /*#__PURE__*/ Object.assign(dictionary, {openai})
