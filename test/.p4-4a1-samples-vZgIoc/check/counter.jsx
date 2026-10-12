export function Counter({ state }) {
  return <div><span className="count">{state.count}</span><button className="inc">+</button></div>
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = {
  INC: (state) => ({ ...state, count: state.count + 1 }),
  SET: (state, count) => ({ ...state, count }),
  SAME: (state) => state,
  MUTATE: (state) => { state.count = 99; return state },
}
