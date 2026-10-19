/**
 * PLAN-11 F-3 type tests: form(schema, { request }) sends the submit itself; `submit` optional
 * with it, required without. Compiled by `npm run test:types`; never executed.
 */
import { form, ABORT } from 'sygnal'
import { z } from 'zod'

const schema = z.object({ title: z.string(), photo: z.instanceof(File) })
const values = { title: '', photo: null as unknown as File }

export const a = form(schema, { values, request: { url: '/api/items' } })
export const b = form(schema, { values, request: (data, state) => ({ url: `/api/items/${state.id}`, method: 'PUT', headers: { 'x-title': data.title } }) })
export const c = form(schema, { values, request: (data) => (data.title ? { url: '/api/items' } : ABORT) })
export const d = form(schema, { values, submit: 'SAVE' })
export const e = form(schema, { values, submit: 'NOTE', request: { url: '/api/items', timeoutMs: 5000 } })
// @ts-expect-error a form needs submit or request
export const f = form(schema, { values })
// @ts-expect-error the form names the reply actions itself
export const g = form(schema, { values, request: { url: '/api/items', ok: 'SAVED' } })
// @ts-expect-error data is the schema's output: no such field
export const h = form(schema, { values, request: (data) => ({ url: '/x/' + data.nope }) })
