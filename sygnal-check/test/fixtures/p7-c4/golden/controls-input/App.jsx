import { ABORT, controls } from 'sygnal'

const { AddItem, Clear, Styled } = controls({ AddItem: 'button', Clear: 'button', Styled: 'span' })

export function App({ state }) {
  return (
    <div>
      <AddItem>+</AddItem>
      <Clear className="big">x</Clear>
      <Styled className="styled">{state.n}</Styled>
    </div>
  )
}
App.initialState = { n: 0 }
App.intent = ({ DOM }) => ({
  ADD: DOM.click(AddItem),
  CLEAR: DOM.click(Clear),
  HOVER: DOM.mouseover(Styled),
})
App.model = {
  ADD: (state) => ({ ...state, n: state.n + 1 }),
  CLEAR: (state) => ({ ...state, n: 0 }),
  HOVER: () => ABORT,
}
