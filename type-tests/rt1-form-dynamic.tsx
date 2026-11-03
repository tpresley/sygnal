/**
 * RT-1 type tests: form((state) => schema, { dynamic }) for fields chosen at run time. Compiled by
 * `npm run test:types`; never executed.
 */
import { form, defineBehavior } from 'sygnal'
import type { FormOutput, UsesState } from 'sygnal'
import { z } from 'zod'

type Host = { pieces: { key: string; kind: 'amount' | 'note' }[] }
const amount = z.object({ amount: z.coerce.number(), currency: z.string() })

export const a = form(z.object({ title: z.string() }).loose(), {
  values: { title: '' },
  dynamic: (state: Host) => Object.fromEntries(state.pieces.map((p) => [p.key, p.kind == 'amount' ? { amount: '', currency: 'USD' } : ''])),
  submit: 'SEND',
})
// a schema of the host state: the output is the returned schema's
const memo = new WeakMap<object, z.ZodObject<{ trip: typeof amount }>>()
const schemaOf = (state: Host) => {
  if (!memo.has(state.pieces)) memo.set(state.pieces, z.object({ trip: amount }))
  return memo.get(state.pieces)!
}
export const b = form(schemaOf, { values: {}, dynamic: () => ({ trip: { amount: '', currency: 'USD' } }), submit: 'SEND' })
const uses = { form: b }
export const out: FormOutput<typeof b> = { trip: { amount: 1, currency: 'USD' } }
// @ts-expect-error the output's amount is a number
export const bad: FormOutput<typeof b> = { trip: { amount: '1', currency: 'USD' } }
declare const st: UsesState<typeof uses>
export const added: Record<string, any> = st.form.added
export const kept: Record<string, true> = st.form.kept
// keepRemoved: false removes a dynamic entry's value when it goes (default true: kept)
export const f = form(z.object({}).loose(), { values: {}, dynamic: () => ({ note: '' }), keepRemoved: false, submit: 'SEND' })
// @ts-expect-error keepRemoved is a boolean
export const g = form(z.object({}).loose(), { values: {}, dynamic: () => ({ note: '' }), keepRemoved: 'yes', submit: 'SEND' })
// @ts-expect-error dynamic returns an object of start values
export const c = form(z.object({}), { values: {}, dynamic: () => 'x', submit: 'SEND' })
// @ts-expect-error a schema function returns a Standard Schema
export const d = form((state: Host) => state.pieces, { values: {}, submit: 'SEND' })
// a behavior's intent gets the host's STATE source as its 4th argument
export const e = defineBehavior({ initialState: { n: 0 }, intent: (_so, _o, _k, host) => ({ SEEN: host.stream.mapTo(1) }) })
