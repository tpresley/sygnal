// CANDIDATE C (prototype): a ready-made component. `const Composed = composer(catalog, { backend })`
// makes a component that holds the compose behavior and renders the canvas; the host renders
// `<Composed commands={cmd} />` (no state=: it shares the host's state, the slice is state.page) and
// sends prompts with `cmd.send('compose', prompt)`.
//
// The parts are the Composed instance's children, not the host's: their PARENT values stop at
// Composed, which relays them as `{ part, value }` (host: CHILD.select(Composed)).
import xs from 'xstream'
import { compose } from './compose.js'

export function composer(catalog, { backend, key = 'page' }) {
  const comps = [...new Set(Object.values(catalog.parts).filter((p) => p.component?.model || p.component?.intent).map((p) => p.component))]
  function Composed({ state }) {
    return <main className={state[key].preview ? 'canvas preview' : 'canvas'}>{catalog.render(state[key], state, { composeKey: key })}</main>
  }
  Composed.uses = { [key]: compose(catalog, { backend }) }
  Composed.intent = ({ CHILD, commands$ }) => ({
    RELAY: xs.merge(...comps.map((C) => CHILD.select(C).map((value) => ({ part: C.name, value })))),
    [`${key}.COMPOSE`]: commands$.select('compose'),
  })
  Composed.model = { RELAY: { PARENT: (_s, d) => d } }
  return Composed
}
