/**
 * PLAN-11 F-1 type tests: `form()` reads the schema's Standard Schema `types` (input for the
 * values, output for the submit payload), `fields` keyed by the values' keys, typed ERRORS /
 * RESET / SUBMIT / DONE. Compiled by `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { form, ABORT } from 'sygnal'
import type {
  Component, UsesState, UsesActions, FormField, FormOutput, FormServerErrors, SchemaInput, SchemaOutput, StandardSchemaLike,
} from 'sygnal'

// A zod-shaped schema: `~standard` with `types?: { input, output } | undefined` (output differs: a coerced number)
declare const zodLike: {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: 'zod'
    readonly validate: (value: unknown) => { value: { email: string; age: number } } | { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey> }> }
    readonly types?: { readonly input: { email: string; age: string; tags: string[] }; readonly output: { email: string; age: number; tags: string[] } } | undefined
  }
}

// A valibot-shaped schema: `types` declared non-optional, async validate
declare const valibotLike: {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: 'valibot'
    readonly validate: (value: unknown) => Promise<{ value: { name: string } } | { issues: ReadonlyArray<{ message: string }> }>
    readonly types: { readonly input: { name: string }; readonly output: { name: string } }
  }
}

// A hand-written schema without `types`
const untyped = { '~standard': { version: 1, vendor: 'mine', validate: (v: unknown) => ({ value: v }) } }

type In = { email: string; age: string; tags: string[] }
type Out = { email: string; age: number; tags: string[] }

describe('F-1 (PLAN-11): typed forms', () => {
  it('reads the schema input and output', () => {
    expectTypeOf<SchemaInput<typeof zodLike>>().toEqualTypeOf<In>()
    expectTypeOf<SchemaOutput<typeof zodLike>>().toEqualTypeOf<Out>()
    expectTypeOf<SchemaInput<typeof valibotLike>>().toEqualTypeOf<{ name: string }>()
    expectTypeOf<SchemaInput<typeof untyped>>().toBeAny()
    expectTypeOf<SchemaInput<StandardSchemaLike>>().toBeAny()
    expectTypeOf<SchemaInput<StandardSchemaLike<{ a: number }>>>().toEqualTypeOf<{ a: number }>()
    // every shape is still a StandardSchemaLike
    const all: StandardSchemaLike[] = [zodLike, valibotLike, untyped]
    void all
  })

  it('types the values from the schema input, not the start values', () => {
    const uses = { form: form(zodLike, { values: { email: '', age: '', tags: [] }, submit: 'SIGN_UP' }) }
    type S = UsesState<typeof uses>
    expectTypeOf<S['form']['values']>().toEqualTypeOf<In>()
    expectTypeOf<S['form']['initial']>().toEqualTypeOf<In>()
    expectTypeOf<S['form']['fields']['email']>().toEqualTypeOf<FormField<string>>()
    expectTypeOf<S['form']['fields']['tags']['value']>().toEqualTypeOf<string[]>()
    // nested paths (array rows, rows' fields) go through the dotted-path index
    expectTypeOf<S['form']['fields']['tags.1']>().toEqualTypeOf<FormField>()
    // the host's submit action gets the schema output
    expectTypeOf<FormOutput<typeof uses.form>>().toEqualTypeOf<Out>()

    const Signup: Component<S> = ({ state }) => {
      const f = state.form.fields
      expectTypeOf(state.form.values.email).toEqualTypeOf<string>()
      expectTypeOf(f.email.value).toEqualTypeOf<string>()
      // @ts-expect-error a top-level name that isn't a field (a typo)
      f.emial
      return <form><input name="email" value={f.email.value} aria-invalid={f.email.invalid} /></form>
    }
    Signup.uses = uses
  })

  it('checks the start values against the schema input', () => {
    // a values function (start values from the host state) is checked too
    form(zodLike, { values: (state: { email: string }) => ({ email: state.email, age: '', tags: [] }), submit: 'S' })
    // @ts-expect-error email is a string in the schema input
    form(zodLike, { values: { email: 1, age: '', tags: [] }, submit: 'S' })
    // @ts-expect-error age is missing
    form(zodLike, { values: { email: '', tags: [] }, submit: 'S' })
    // @ts-expect-error the values function returns the wrong type
    form(zodLike, { values: () => ({ name: 'x' }), submit: 'S' })
    const v = form(valibotLike, { values: { name: '' }, submit: 'SAVE' })
    expectTypeOf<UsesState<{ form: typeof v }>['form']['values']>().toEqualTypeOf<{ name: string }>()
  })

  it('a schema without types: the values come from `values`, the output is any', () => {
    const uses = { form: form(untyped, { values: { title: '' }, submit: 'SAVE' }) }
    type S = UsesState<typeof uses>
    expectTypeOf<S['form']['values']>().toEqualTypeOf<{ title: string }>()
    expectTypeOf<S['form']['fields']['title']['value']>().toEqualTypeOf<string>()
    expectTypeOf<FormOutput<typeof uses.form>>().toBeAny()
    // any values: fields by any name
    const loose = form(untyped, { values: {} as any, submit: 'SAVE' })
    expectTypeOf<UsesState<{ form: typeof loose }>['form']['fields']>().toEqualTypeOf<Record<string, FormField>>()
    // an explicit type argument still wins
    const explicit = form<{ n: number }>(zodLike, { values: { n: 0 }, submit: 'SAVE' })
    expectTypeOf<UsesState<{ form: typeof explicit }>['form']['values']>().toEqualTypeOf<{ n: number }>()
  })

  it('types the reply and reset actions', () => {
    const uses = { form: form(zodLike, { values: { email: '', age: '', tags: [] }, submit: 'SIGN_UP' }) }
    type A = UsesActions<typeof uses>
    expectTypeOf<A['form.ERRORS']>().toEqualTypeOf<FormServerErrors>()
    expectTypeOf<A['form.RESET']>().toEqualTypeOf<In | null | undefined>()
    expectTypeOf<A['form.DONE']>().toBeUnknown()
    expectTypeOf<A['form.SUBMIT']>().toBeUnknown()
    const e1: FormServerErrors = { email: 'Taken' }
    const e2: FormServerErrors = { email: ['Taken', 'Too short'] }
    const e3: FormServerErrors = { status: 422, body: { errors: { email: 'Taken' } } }
    const e4: FormServerErrors = [{ path: ['email'], message: 'Taken' }]
    void [e1, e2, e3, e4]
    // @ts-expect-error a message is a string (or a list of them)
    const bad: FormServerErrors = { email: 42 }
    void bad

    type State = { sent: number } & UsesState<typeof uses>
    const Signup: Component<State, {}, any, A & { SIGN_UP: SchemaOutput<typeof zodLike> }> = ({ state }) => <form>{state.sent}</form>
    Signup.uses = uses
    Signup.model = {
      SIGN_UP: {
        STATE: (state, data) => {
          expectTypeOf(data).toEqualTypeOf<Out>()
          expectTypeOf(data.age).toEqualTypeOf<number>()
          return { ...state, sent: state.sent + 1 }
        },
      },
      'form.RESET': (state) => (state.sent > 3 ? ABORT : state),
    }
  })
})

describe('F-1 (PLAN-11): the real validators', () => {
  it('zod, valibot and arktype schemas infer', async () => {
    const { z } = await import('zod')
    const v = await import('valibot')
    const { type } = await import('arktype')

    const zs = z.object({ email: z.string().email(), age: z.coerce.number() })
    const zf = form(zs, { values: { email: '', age: '' }, submit: 'S' })
    expectTypeOf<UsesState<{ form: typeof zf }>['form']['values']['email']>().toEqualTypeOf<string>()
    expectTypeOf<FormOutput<typeof zf>>().toEqualTypeOf<{ email: string; age: number }>()
    // @ts-expect-error email is a string
    form(zs, { values: { email: 0, age: '' }, submit: 'S' })

    const vs = v.object({ name: v.string(), count: v.pipe(v.string(), v.transform(Number)) })
    const vf = form(vs, { values: { name: '', count: '' }, submit: 'S' })
    expectTypeOf<UsesState<{ form: typeof vf }>['form']['values']>().toEqualTypeOf<{ name: string; count: string }>()
    expectTypeOf<FormOutput<typeof vf>>().toEqualTypeOf<{ name: string; count: number }>()

    const as = type({ title: 'string' })
    const af = form(as, { values: { title: '' }, submit: 'S' })
    expectTypeOf<UsesState<{ form: typeof af }>['form']['fields']['title']['value']>().toEqualTypeOf<string>()
  })
})
