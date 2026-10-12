/*
 * PLACEHOLDER: worker A owns this file (PLAN-9 K-3, phase1-contract.md). Worker B's branch
 * (p9-decisions) carries this stub only so decisions.ts has the module it imports; at merge the
 * coordinator takes A's version. B's tests mock this module with the stand-in in
 * test/p9-decisions-helpers.js.
 */
const placeholder = (name: string): never => {
  throw new Error(`[Sygnal] compose layout.ts placeholder: ${name}() is worker A's (PLAN-9 K-3)`)
}
export const fromTree = (_catalog: any, _tree: any, _previous?: any): any => placeholder('fromTree')
export const toTree = (_layout: any): any => placeholder('toTree')
export const finish = (_catalog: any, _layout: any, _state: any): any => placeholder('finish')
