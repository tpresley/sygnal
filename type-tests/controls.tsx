/**
 * PLAN-4 1-T: types for CT-1 controls.
 *
 * - controls(spec): one Control per key; a tag spec takes its props from the element type,
 *   a spec object (D101) from its `__props` phantom
 * - DOM.select(control) / DOM.<event>(control) / DOM.select('document').select(control):
 *   streams typed for the control's element; enriched helpers keep their types
 * - renderComponent: simulateEvent(control, ...), `{ within }`, query(control), queryAll(control)
 * - a component where a control or selector is expected is a type error (SYG124 at runtime)
 */
import { controls, renderComponent } from 'sygnal'
import type { Component, Control, ControlSpec, ControlSpecObject, IntentSources, VNode } from 'sygnal'
import type { Stream, MemoryStream } from 'xstream'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}
/** mutually assignable (an intersection such as `EventTarget & HTMLButtonElement` counts) */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Payload<S> = S extends Stream<infer T> ? T : never

// ─── controls() ────────────────────────────────────────────────────────────

const { Draft, Add, Agree, Pick, Help, Rating } = controls({
  Draft: 'input',
  Add: 'button',
  Agree: 'input',
  Pick: 'select',
  Help: 'dialog',
  Rating: 'wa-rating',
})

const keyCheck: Control<'Add', HTMLButtonElement> = Add
void keyCheck

// a control stringifies to its selector
const sel: string = `${Add}`
const nested: string = `li:nth-child(2) ${Add}`
const asString: string = Add.toString()
expectType<Equal<ReturnType<typeof Add.toString>, '[data-control="Add"]'>>()
void sel; void nested; void asString

// ─── props per tag ─────────────────────────────────────────────────────────

type State = { draft: string; agree: boolean; count: number; choice: string }

function AddTodo({ state }: { state: State }) {
  return (
    <div>
      <Draft className="field" value={state.draft} placeholder="New todo" autoFocus />
      <Draft type="number" value={state.count} disabled={false} key="d" data-id="7" aria-label="draft" />
      <Agree type="checkbox" checked={state.agree} name="agree" />
      <Pick value={state.choice} multiple={false}><option value="a">A</option></Pick>
      <Add className="primary" type="submit" style={{ color: 'red' }} class={{ busy: true }}>Add</Add>
      <Help open={false} attrs={{ role: 'dialog' }}>Help text</Help>
      <Rating value={3} max={5} anything="custom elements take any prop" />
    </div>
  )
}
void AddTodo

// @ts-expect-error unknown prop on an input
const bad1 = <Draft valeu="x" />
// @ts-expect-error `checked` is a boolean
const bad2 = <Agree checked="yes" />
// @ts-expect-error `multiple` is not a button prop
const bad3 = <Add multiple />
// @ts-expect-error event handlers are not view props (bind events in intent)
const bad4 = <Add onclick={() => {}} />
// @ts-expect-error read-only DOM properties are not props
const bad5 = <Draft tagName="input" />
void bad1; void bad2; void bad3; void bad4; void bad5

// ─── spec objects (D101): props from the __props phantom ───────────────────

type StarProps = { stars: number; label?: string }
const starSpec: ControlSpecObject<StarProps> = {
  kind: 'test-widget',
  vnode: (props: StarProps, children: unknown[]) => ({ sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined }) as unknown as VNode,
  commands: { reset: (elm: Element, options: Record<string, unknown>) => { void elm; void options } },
}
const starsFromObject = {
  kind: 'test-widget',
  vnode: (props: StarProps): VNode => props as unknown as VNode,
  __props: undefined as StarProps | undefined,
}
// the frozen D101 union accepts both forms
const asSpec: ControlSpec<StarProps> = starSpec
const tagSpec: ControlSpec = 'input'
void asSpec; void tagSpec
const { Stars, Stars2 } = controls({ Stars: starSpec, Stars2: starsFromObject })

const okStars = <Stars stars={4} label="four" key="s" />
const okStars2 = <Stars2 stars={2} />
// @ts-expect-error `stars` is required by the spec's props
const badStars1 = <Stars label="x" />
// @ts-expect-error props come from the spec, not from an intrinsic element
const badStars2 = <Stars2 stars={2} value="x" />
void okStars; void okStars2; void badStars1; void badStars2

// spec-object controls are accepted everywhere a control is
const specIntent = ({ DOM }: IntentSources<State>) => ({ RATE: DOM.click(Stars) })
void specIntent

// ─── DOM source ────────────────────────────────────────────────────────────

const intent = ({ DOM }: IntentSources<State>) => {
  const draft$ = DOM.input(Draft).value()
  expectType<Equal<Payload<typeof draft$>, string>>()

  const agree$ = DOM.change(Agree).checked()
  expectType<Equal<Payload<typeof agree$>, boolean>>()

  const add$ = DOM.click(Add)
  type AddEvent = Payload<typeof add$>
  expectType<AddEvent extends MouseEvent ? true : false>()
  expectType<Same<AddEvent['currentTarget'], HTMLButtonElement>>()

  const key$ = DOM.keydown(Draft).key()
  expectType<Equal<Payload<typeof key$>, string>>()
  const keyEvent$ = DOM.keydown(Draft)
  expectType<Same<Payload<typeof keyEvent$>['currentTarget'], HTMLInputElement>>()

  const close$ = DOM.close(Help)
  expectType<Same<Payload<typeof close$>['currentTarget'], HTMLDialogElement>>()

  // DOM.select(control).events(name)
  const sel$ = DOM.select(Add).events('click')
  expectType<Payload<typeof sel$> extends MouseEvent ? true : false>()
  expectType<Same<Payload<typeof sel$>['currentTarget'], HTMLButtonElement>>()
  const selValue$ = DOM.select(Draft).events('input').value()
  expectType<Equal<Payload<typeof selValue$>, string>>()
  const el$ = DOM.select(Draft).element()
  expectType<Equal<typeof el$, MemoryStream<HTMLInputElement>>>()

  // nested: a control under a string selector
  const nestedSel$ = DOM.select('.list').select(Add).events('click')
  expectType<Same<Payload<typeof nestedSel$>['currentTarget'], HTMLButtonElement>>()

  // document-level delegation filtered to a control
  const docClick$ = DOM.select('document').select(Add).events('click')
  expectType<Payload<typeof docClick$> extends MouseEvent ? true : false>()

  // custom events through the index signature also take a control
  const custom$ = DOM['wa-change'](Rating)
  void custom$

  // string selectors are unchanged
  const str$ = DOM.click('.add')
  expectType<Equal<Payload<typeof str$>, HTMLElementEventMap['click']>>()
  const strSel$ = DOM.select('.add').events('click')
  expectType<Equal<Payload<typeof strSel$>, HTMLElementEventMap['click']>>()
  const strDraft$ = DOM.input('.draft').value()
  expectType<Equal<Payload<typeof strDraft$>, string>>()

  return { DRAFT: draft$, AGREE: agree$, ADD: add$ }
}
void intent

// ─── a component is not a control (SYG124) ─────────────────────────────────

const Child: Component<{ n: number }> = ({ state }) => <div>{state.n}</div>
function PlainChild() { return <div /> }

const wrongIntent = ({ DOM }: IntentSources<State>) => ({
  // @ts-expect-error a component where a control or selector is expected
  A: DOM.click(Child),
  // @ts-expect-error a plain function component either
  B: DOM.click(PlainChild),
  // @ts-expect-error DOM.select(component)
  C: DOM.select(Child),
  // @ts-expect-error not a control: a spec object itself
  D: DOM.click(starSpec),
})
void wrongIntent

// ─── testing ───────────────────────────────────────────────────────────────

function Todo({ state }: { state: State }) { return <div><Draft value={state.draft} /><Add>Add</Add></div> }
Todo.initialState = { draft: '', agree: false, count: 0, choice: 'a' } as State

async function testing() {
  const t = renderComponent(Todo)
  t.simulateEvent(Add, 'click')
  t.simulateEvent(Draft, 'input', { value: 'milk' })
  t.simulateEvent(Add, 'click', { within: '[data-id="2"]' })
  t.simulateEvent('.item', 'click', { within: Pick })
  t.simulateEvent(`li ${Add}`, 'click')
  // @ts-expect-error within is a selector or a control
  t.simulateEvent(Add, 'click', { within: 2 })
  // @ts-expect-error a component is not a control
  t.simulateEvent(Child, 'click')

  const draft = t.query(Draft)
  expectType<Equal<typeof draft, HTMLInputElement | null>>()
  const v: string | undefined = t.query(Draft)?.value
  void v
  const adds = t.queryAll(Add)
  expectType<Equal<typeof adds, HTMLButtonElement[]>>()
  const stars = t.query(Stars)
  expectType<Equal<typeof stars, Element | null>>()

  // strings unchanged
  const any1 = t.query('.x')
  expectType<Equal<typeof any1, Element | null>>()
  const all1 = t.queryAll('.x')
  expectType<Equal<typeof all1, Element[]>>()
  // @ts-expect-error a component is not a control
  t.query(Child)
}
void testing
