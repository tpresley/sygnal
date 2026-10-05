// PLAN-5 2-A (A-1): <Collection viewTransitionName="card" /> takes a string prefix.
import { Collection } from 'sygnal'

const Row = ({ state }: { state: { id: number } }) => <li>{state.id}</li>

export const ok = <ul><Collection of={Row} from="rows" viewTransitionName="row" /></ul>
// @ts-expect-error a CSS identifier prefix, not a function
export const fn = <ul><Collection of={Row} from="rows" viewTransitionName={(item: any) => 'row-' + item.id} /></ul>
// @ts-expect-error a string prefix, not a boolean
export const bool = <ul><Collection of={Row} from="rows" viewTransitionName={true} /></ul>
