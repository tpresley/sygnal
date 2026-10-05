/**
 * PLAN-5 W-3: typing a web-component library's tags (from spike 0-S6).
 *
 * A Lit-based library (Web Awesome, Shoelace, Material Web, ...) ships
 *   declare global { interface HTMLElementTagNameMap { 'wa-rating': WaRating } }
 * Sygnal already reads HTMLElementTagNameMap for controls (ControlElementOf / IntrinsicControlProps),
 * so controls made from those tags are typed with no extra code. For the canonical tag form
 * (<wa-rating className="food" />) the app adds one augmentation for the library's prefix:
 *
 *   type WaTags = { [K in keyof HTMLElementTagNameMap as K extends `wa-${string}` ? K : never]: IntrinsicControlProps<K> }
 *   declare global { namespace JSX { interface IntrinsicElements extends WaTags {} } }
 *
 * The stand-in below mirrors what Web Awesome 3 ships (dist/components/rating/rating.d.ts), under
 * an `ex-` prefix so it can't collide with other type tests that use 'wa-rating' untyped.
 */
import { controls, set } from 'sygnal'
import type { Component, IntrinsicControlProps, IntentSources } from 'sygnal'
import type { Stream } from 'xstream'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}
type Payload<S> = S extends Stream<infer T> ? T : never
/** mutually assignable (an intersection such as `EventTarget & ExRating` counts) */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// ─── what the library ships ────────────────────────────────────────────────

declare class ExRating extends HTMLElement {
  name: string | null
  label: string
  value: number
  max: number
  precision: number
  readonly: boolean
  disabled: boolean
  getSymbol: (value: number, isSelected: boolean) => string
  size: 'xs' | 's' | 'm' | 'l' | 'xl'
  readonly validity: ValidityState
  handleSizeChange(): void
}
declare class ExInput extends HTMLElement {
  value: string | null
  label: string
  withClear: boolean
  type: 'text' | 'email' | 'number'
}
declare global {
  interface HTMLElementTagNameMap {
    'ex-rating': ExRating
    'ex-input': ExInput
  }
}

// ─── what the app adds: one augmentation per library prefix ────────────────

type ExTags = {
  [K in keyof HTMLElementTagNameMap as K extends `ex-${string}` ? K : never]: IntrinsicControlProps<K>
}
declare global {
  namespace JSX {
    interface IntrinsicElements extends ExTags {}
  }
}

// ─── canonical: tags + class selectors ─────────────────────────────────────

type State = { food: number; email: string | null }

const Review: Component<State> = ({ state }) => (
  <div>
    <ex-rating className="food" label="Food" value={state.food} readonly={false} attrs={{ size: 'l' }} />
    <ex-input className="email" label="Email" value={state.email} withClear type="email" />
  </div>
)
Review.intent = ({ DOM }) => ({
  FOOD: DOM.select('.food').events('change').value(Number),
  HOVER: DOM.select('.food').events('wa-hover').detail<{ phase: string; value: number }>(),
  HOVER_VALUE: DOM.select('.food').events('wa-hover').detail((d: { value: number }) => d.value),
  // built-in names keep their event types; any other name is an Event
  KEY: DOM.select('.food').events('keydown').map((e) => e.key),
  DOC: DOM.select('document').events('wa-after-show').detail(),
})
Review.model = { FOOD: set((s, food: number) => ({ food })) }

function badTags() {
  // @ts-expect-error value is a number
  void <ex-rating value="3" />
  // @ts-expect-error not a property of ExRating
  void <ex-rating stars={3} />
  // @ts-expect-error methods are not props
  void <ex-rating handleSizeChange={() => {}} />
  // @ts-expect-error readonly properties are not props
  void <ex-rating validity={undefined as any} />
  // @ts-expect-error size is a union
  void <ex-rating size="huge" />
  // a function-valued property (getSymbol) is excluded too: set it with props={{ getSymbol }}
  // @ts-expect-error
  void <ex-rating getSymbol={() => ''} />
  void <ex-rating props={{ getSymbol: () => '' }} />
  // other custom elements stay untyped (the index signature)
  void <other-thing anything={1} />
}
void badTags

// ─── alternative: controls made from the same tags are typed with no augmentation ──

const { Rating, Email } = controls({ Rating: 'ex-rating', Email: 'ex-input' })

const Survey: Component<{ service: number }> = ({ state }) => (
  <div>
    <Rating label="Service" value={state.service} />
    <Email label="Contact" withClear />
  </div>
)
function badControls() {
  // @ts-expect-error value is a number
  void <Rating value="x" />
  // @ts-expect-error not a property of ExInput
  void <Email stars={1} />
}
void badControls

function intent({ DOM }: IntentSources) {
  const service$ = DOM.select(Rating).events('change').value(Number)
  const target$ = DOM.select(Rating).events('change').map((e) => e.currentTarget)
  const hover$ = DOM.select(Rating).events('wa-hover').detail((d: { value: number }) => d.value)
  expectType<Equal<Payload<typeof service$>, number>>()
  expectType<Same<Payload<typeof target$>, ExRating>>()
  expectType<Equal<Payload<typeof hover$>, number>>()
  return { SERVICE: service$, HOVER: hover$ }
}
Survey.intent = intent
void Review
