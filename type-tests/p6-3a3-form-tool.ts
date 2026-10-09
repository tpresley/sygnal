/**
 * PLAN-6 A-3 type tests: `form(…, { tool })` (experimental, D241). Compiled by
 * `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { form } from 'sygnal'
import type { FormTool, FormToolResult, FormOptions, FieldErrors, StandardSchemaLike } from 'sygnal'

declare const schema: StandardSchemaLike

describe('A-3: form tool', () => {
  it('takes { name, description, autosubmit? }', () => {
    form(schema, { values: { email: '' }, submit: 'SIGN_UP', tool: { name: 'sign_up', description: 'Create an account' } })
    form(schema, { values: { email: '' }, submit: 'SIGN_UP', tool: { name: 'sign_up', description: 'Create an account', autosubmit: true } })
    // @ts-expect-error description is required
    form(schema, { values: {}, submit: 'S', tool: { name: 'x' } })
    // @ts-expect-error autosubmit is a boolean
    form(schema, { values: {}, submit: 'S', tool: { name: 'x', description: 'y', autosubmit: 'yes' } })
    expectTypeOf<FormOptions['tool']>().toEqualTypeOf<FormTool | undefined>()
  })
  it('the agent gets a FormToolResult', () => {
    const r = {} as FormToolResult
    if (r.ok) expectTypeOf(r.values).toBeAny()
    else if ('errors' in r) expectTypeOf(r.errors).toEqualTypeOf<FieldErrors>()
    else expectTypeOf(r.error).toEqualTypeOf<string>()
  })
})
