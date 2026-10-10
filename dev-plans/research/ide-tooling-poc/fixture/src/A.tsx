function Counter({ state }: any) {
  return <div><button className="inc">+</button><span>{state.count}</span></div>
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INCREMENT: DOM.click('.incc') })
Counter.model = { INCREMNT: (state) => ({ ...state, count: state.count + 1 }) }
export default Counter
