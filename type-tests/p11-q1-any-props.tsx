/**
 * PLAN-11 Q-1 type tests: `Component<State, any>` (PROPS = any) keeps `state` and `context`
 * typed; any other prop is still allowed. Compiled by `npm run test:types`; never executed.
 */
import type { Component, ViewProps } from 'sygnal'

type Tile = { value: number; merged: boolean }

export const TILE: Component<Tile, any, any> = ({ state, label }) => {
  const n: number = state.value
  // @ts-expect-error state is typed: no such field
  state.nope
  // @ts-expect-error value is a number
  const s: string = state.value
  return <div title={label}>{n}{s}</div>
}

export function Plain({ state, context }: ViewProps<Tile, any, { theme: string }>) {
  const t: string = context.theme
  // @ts-expect-error merged is a boolean
  const m: string = state.merged
  return <div>{t}{m}</div>
}
