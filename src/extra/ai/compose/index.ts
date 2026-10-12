/*
 * PLAN-9: composing UI from prepared parts (phase1-contract.md). `defineCatalog` (K-1),
 * `catalog.render` (K-2), the layout utilities (K-3), the `compose` behavior (C-1) with its
 * backends chained on it (D451) and `compose.answer` (D462), and `composeWith` (T-1). Side-effect
 * free; exported from src/extra/ai/index.ts (and so from 'sygnal/ai').
 */
import {composeBehavior} from './behavior'
import {decisions} from './decisions'
import {llm} from './llm'

/** a result part's PARENT value: `{ scope, node, value }` (the answer for the card it is in) */
export const answer = (props: any, value: any) => ({scope: props?.scope, node: props?.node, value})

/** compose(catalog, { backend, form?, prompt?, key? }) + `.decisions()`, `.llm()`, `.answer()` */
export const compose = /*#__PURE__*/ Object.assign((catalog: any, options?: any) => composeBehavior(catalog, options), {decisions, llm, answer})

export {defineCatalog} from './catalog'
export {fromTree, toTree, removeNode} from './layout'
export {composeWith} from './testing'
export {askCard} from './ask'
