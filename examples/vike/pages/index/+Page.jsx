import { ABORT } from 'sygnal'

function Page({ state }) {
  return (
    <div className="page">
      <nav>
        <a href="/">Home</a> | <a href="/about">About</a>
      </nav>
      <h1>Home</h1>
      <p>Count: {state.count}</p>
      <button className="inc">+1</button>
      <button className="dec">-1</button>
    </div>
  )
}

Page.initialState = { count: 0 }

Page.intent = ({ DOM }) => ({
  INC: DOM.click('.inc'),
  DEC: DOM.click('.dec'),
})

Page.model = {
  INC: (state) => ({ ...state, count: state.count + 1 }),
  DEC: (state) => {
    if (state.count <= 0) return ABORT
    return { ...state, count: state.count - 1 }
  },
}

export default Page
