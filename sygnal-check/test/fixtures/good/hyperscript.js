// Views written with h() / hyperscript helpers instead of JSX. Expect: no diagnostics.
import { h, div, button } from 'sygnal'

function Counter({ state }) {
  return div('.counter', [
    button('.inc', '+'),
    h('span#value.value', String(state.count)),
  ])
}

Counter.intent = ({ DOM }) => ({
  INC: DOM.click('.inc'),
  VALUE: DOM.click('#value'),
})

Counter.model = {
  INC: (state) => ({ ...state, count: state.count + 1 }),
  VALUE: (state) => state,
}

export default Counter
