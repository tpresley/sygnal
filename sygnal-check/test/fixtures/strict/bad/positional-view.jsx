// SYG501: views that use the positional (props, state, context) arguments.
function Counter(props, state) { // expect: SYG501 error
  return (
    <div className="counter">
      <button className="inc">+</button>
      <span>{state.count}</span>
      <Badge label="count" />
      <Panel title="x" />
    </div>
  )
}

// a plain function rendered as a component tag is checked too
const Badge = ({ label }, state, context) => <i className={context.theme}>{label}{state.count}</i> // expect: SYG501 error

// a first-param name starting with _ is dropped from the rewrite
function Panel(_props, { count }) { // expect: SYG501 error
  return <section>{count}</section>
}

Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
Counter.model = { INC: state => ({ ...state, count: state.count + 1 }) }

export default Counter
