/**
 * PLAN-5 F-1 type tests: the `form` behavior and the form helpers. Compiled by
 * `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { form, checkForm, formErrors, setField, getField, fieldName, fieldNames, replyErrors, focusInvalid, ABORT } from 'sygnal'
import type { Component, UsesState, UsesActions, FormField, FormState, FieldErrors, StandardSchemaLike, ElementCommand } from 'sygnal'

type Values = { email: string; addresses: { id: number; city: string }[] }
declare const schema: StandardSchemaLike

describe('F-1: form', () => {
  it('types the slice, its calculated fields and the namespaced actions', () => {
    const uses = { form: form<Values>(schema, { values: { email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP', check: { email: { request: (email) => ({ url: '/api/free', query: { email } }), error: (b) => !b.free && 'Taken' } } }) }
    type S = UsesState<typeof uses>
    expectTypeOf<S['form']['values']>().toEqualTypeOf<Values>()
    expectTypeOf<S['form']['fields']>().toEqualTypeOf<Record<string, FormField>>()
    expectTypeOf<S['form']['submitting']>().toEqualTypeOf<boolean>()
    expectTypeOf<S['form']['error']>().toEqualTypeOf<string>()
    expectTypeOf<UsesActions<typeof uses>['form.CHANGE']>().toEqualTypeOf<{ name: string; value: any }>()
    expectTypeOf<UsesActions<typeof uses>['form.REMOVE']>().toEqualTypeOf<{ field: string; id: any }>()
    expectTypeOf<FormState<Values>['errors']>().toEqualTypeOf<FieldErrors>()

    const Signup: Component<{ done: boolean } & S> = ({ state }) => {
      const f = state.form.fields
      return <form><input name="email" value={f.email.value} aria-invalid={f.email.invalid} /></form>
    }
    Signup.uses = uses
    // @ts-expect-error submit is required
    form(schema, { values: {} })
    // @ts-expect-error show is 'blur' | 'input' | 'submit'
    form(schema, { values: {}, submit: 'X', show: 'change' })
  })

  it('types the helpers', () => {
    const v: Values = { email: '', addresses: [] }
    expectTypeOf(setField(v, 'email', 'a')).toEqualTypeOf<Values>()
    expectTypeOf(getField(v, 'email')).toBeAny()
    expectTypeOf(fieldName(v, ['addresses', 0, 'city'])).toEqualTypeOf<string>()
    expectTypeOf(fieldNames(v)).toEqualTypeOf<string[]>()
    expectTypeOf(replyErrors({ status: 422, body: {} })).toEqualTypeOf<FieldErrors>()
    expectTypeOf(formErrors(schema, v)).toEqualTypeOf<FieldErrors | Promise<FieldErrors>>()
    const r = checkForm(schema, v)
    if (!('then' in r)) expectTypeOf(r.errors).toEqualTypeOf<FieldErrors>()
    expectTypeOf(focusInvalid({ email: 'Bad' })).toEqualTypeOf<ElementCommand | ABORT>()
  })
})
