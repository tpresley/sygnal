/**
 * PLAN-9 0-S2 (D456): `key` is accepted on any component tag (JSX.IntrinsicAttributes) without
 * the component declaring it; it is never a prop (the view does not see it). `id` is still an
 * ordinary prop: a component that doesn't declare it rejects it.
 */
import type { Component } from 'sygnal'

type S = { n: number }
type P = { name: string }
const Typed: Component<S, P> = ({ state, name }) => <b>{name}{state.n}</b>
function Plain({ name }: { name: string }) { return <b>{name}</b> }

export const typedKeyed = <Typed key="k" name="x" state="s" />
export const plainKeyed = <Plain key={1} name="x" />
export const nullKey = <Plain key={null} name="x" />
// @ts-expect-error id is a prop, not an identity attribute: Plain does not declare it
export const plainId = <Plain id="i" name="x" />
// @ts-expect-error a key is a string or a number
export const objectKey = <Plain key={{ a: 1 }} name="x" />
