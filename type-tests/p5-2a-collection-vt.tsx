// PLAN-5 2-A (A-1): <Collection viewTransitionName="card" /> takes a string prefix.
import { Collection, VirtualCollection } from 'sygnal'

const Row = ({ state }: { state: { id: number } }) => <li>{state.id}</li>

export const ok = <ul><Collection of={Row} from="rows" viewTransitionName="row" /></ul>
// @ts-expect-error a CSS identifier prefix, not a function
export const fn = <ul><Collection of={Row} from="rows" viewTransitionName={(item: any) => 'row-' + item.id} /></ul>
// @ts-expect-error a string prefix, not a boolean
export const bool = <ul><Collection of={Row} from="rows" viewTransitionName={true} /></ul>

// PLAN-5 3-F G-417: VirtualCollection takes the same prefix
export const virtual = <VirtualCollection of={Row} from="rows" className="rows" viewTransitionName="row" />
// @ts-expect-error a string prefix, not a function
export const virtualFn = <VirtualCollection of={Row} from="rows" viewTransitionName={(item: any) => 'row-' + item.id} />

// PLAN-5 4-H (D229): a Collection has no wrapper element; className on it is a removed form (SYG612)
// @ts-expect-error className is not a Collection prop (put it on your own element)
export const wrapped = <Collection of={Row} from="rows" className="rows" />
export const own = <ul className="rows"><Collection of={Row} from="rows" /></ul>
