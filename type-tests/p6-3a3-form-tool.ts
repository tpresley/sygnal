/**
 * PLAN-6 A-3 type tests: `form(…, { tool: formTool({ … }) })` (experimental, D241, D291). Compiled
 * by `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { form } from 'sygnal'
import { formTool } from 'sygnal/ai'
import { formTool as fromMain } from 'sygnal'
import type { FormTool, FormToolHandle, FormToolResult, FormOptions, FieldErrors, StandardSchemaLike } from 'sygnal'

declare const schema: StandardSchemaLike

describe('A-3: form tool', () => {
  it('takes formTool({ name, description, autosubmit? })', () => {
    form(schema, { values: { email: '' }, submit: 'SIGN_UP', tool: formTool({ name: 'sign_up', description: 'Create an account' }) })
    form(schema, { values: { email: '' }, submit: 'SIGN_UP', tool: fromMain({ name: 'sign_up', description: 'Create an account', autosubmit: true }) })
    // @ts-expect-error a plain object isn't a tool (SYG245 at run time): use formTool()
    form(schema, { values: {}, submit: 'S', tool: { name: 'x', description: 'y' } })
    // @ts-expect-error description is required
    formTool({ name: 'x' })
    // @ts-expect-error autosubmit is a boolean
    formTool({ name: 'x', description: 'y', autosubmit: 'yes' })
    expectTypeOf<FormOptions['tool']>().toEqualTypeOf<FormToolHandle | undefined>()
    expectTypeOf(formTool).parameter(0).toEqualTypeOf<FormTool>()
  })
  it('the agent gets a FormToolResult', () => {
    const r = {} as FormToolResult
    if (r.ok) expectTypeOf(r.values).toBeAny()
    else if ('errors' in r) expectTypeOf(r.errors).toEqualTypeOf<FieldErrors>()
    else expectTypeOf(r.error).toEqualTypeOf<string>()
  })
})
