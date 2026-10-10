import { ABORT } from 'sygnal'

export function App({ state }) {
  return (
    <div>
      <button className="add-item">+</button>
      <button className="clear big">x</button>
      <span className="styled">{state.n}</span>
    </div>
  )
}
App.initialState = { n: 0 }
App.intent = ({ DOM }) => ({
  ADD: DOM.click('.add-item'),
  CLEAR: DOM.click('.clear'),
  HOVER: DOM.mouseover('.styled'),
})
App.model = {
  ADD: (state) => ({ ...state, n: state.n + 1 }),
  CLEAR: (state) => ({ ...state, n: 0 }),
  HOVER: () => ABORT,
}
