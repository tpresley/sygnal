// PLAN-6 M-1: decide() and the question builders; answer types inferred from the questions.
import { decide, choice, noul, score } from 'sygnal/ai'
import type { Decision, Answers, RefusalAnswer, DecideRequest, NoulAnswer } from 'sygnal/ai'
import type { ResourceRequest, FetchRequest } from 'sygnal'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const assert = <T extends true>() => {}

const questions = {
  topic: choice('What is this ticket about?', { billing: 'Payments', bug: 'A defect', account: null }),
  tags: choice('Which tag?', ['red', 'green']),
  urgent: noul('Urgent?', { true: 'Blocked', false: 'A question' }),
  spam: noul({ question: 'Mentions {x}?', x: 'money' }),
  mood: score('How upset?', ['calm', 'annoyed', 'angry']),
}

assert<Equal<typeof questions.topic.type, 'choice'>>()
assert<Equal<keyof typeof questions.topic.criteria, 'billing' | 'bug' | 'account'>>()
assert<Equal<keyof typeof questions.tags.criteria, 'red' | 'green'>>()

declare const d: Decision<typeof questions>
assert<Equal<typeof d.answers.topic.choice, 'billing' | 'bug' | 'account'>>()
assert<Equal<typeof d.answers.tags.choice, 'red' | 'green'>>()
const p: number = d.answers.topic.probabilities.billing
const c: number = d.answers.topic.confidence
const yes: number = d.answers.urgent.noul
const s: number = d.answers.mood.score
assert<Equal<typeof d.answers.mood.legend[string], 'calm' | 'annoyed' | 'angry'>>()
// @ts-expect-error a noul answer has no choice
d.answers.urgent.choice
// @ts-expect-error not a question
d.answers.nope
// @ts-expect-error not an option
const wrong: typeof d.answers.topic.choice = 'refund'

declare const a: Answers<typeof questions>
assert<Equal<typeof a.urgent, NoulAnswer>>()

// the request: passes fetch keys through; usable as a reply-action request and a resource
const r = decide({ model: 'nimble', state: 'charged twice', questions, ok: 'TRIAGED', error: 'FAILED', key: 'k', latest: true, headers: { a: 'b' } })
const asFetch: FetchRequest = r
const asResource: ResourceRequest = decide({ url: 'http://localhost:11434/v1/systemone', model: 'nimble', state: { text: 'x' }, questions, keepPrevious: true })
assert<Equal<typeof r, DecideRequest<typeof questions>>>()
type ReplyOf<R> = R extends { readonly __decision?: infer D } ? D : never
const answers = (null as unknown as Exclude<ReplyOf<typeof r>, undefined>).answers
assert<Equal<typeof answers.topic.choice, 'billing' | 'bug' | 'account'>>()

// decide.openai: an answer may be a refusal
const o = decide.openai({ model: 'gpt-6-luna', state: 'x', questions, ok: 'TRIAGED', images: ['iVBOR'] })
const oFetch: FetchRequest = o
declare const od: Exclude<ReplyOf<typeof o>, undefined>
const ot = od.answers.topic
if (ot.type === 'refusal') { const _r: RefusalAnswer = ot } else { const _c: 'billing' | 'bug' | 'account' = ot.choice }

// @ts-expect-error model is required
decide({ state: 'x', questions })
// @ts-expect-error a score needs at least two levels
score('?', ['only'])
// @ts-expect-error noul criteria are { true, false }
noul('?', { yes: 'a' })

export { p, c, yes, s, asFetch, asResource, oFetch, wrong }
