// TypeScript: `const X: Component<…> = …` with `export default X`.
import type { Component } from 'sygnal'

type State = { open: boolean }

const Drawer: Component<State> = ({ state }) => (
  <aside className={state.open ? 'drawer open' : 'drawer'}>
    <button className="drawer-toggle">≡</button>
  </aside>
)

Drawer.intent = ({ DOM }) => ({
  TOGGLE: DOM.click('.drawer-toggel'), // expect: SYG110
  CLOSE: DOM.click('.drawer.open'), // expect: SYG101
  ESC: DOM.select('document').select('.anything').events('keydown'),
})

Drawer.model = {
  TOGGLE: (state) => ({ ...state, open: !state.open }),
  ESC: (state) => ({ ...state, open: false }),
}

export default Drawer
