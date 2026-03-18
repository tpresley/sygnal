export const counter = `function Component({ state }) {
  return (
    <div>
      <h2>Count: {state.count}</h2>
      <button className="increment">+</button>
      <button className="decrement">-</button>
    </div>
  )
}

Component.initialState = { count: 0 }

Component.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click'),
  DECREMENT: DOM.select('.decrement').events('click'),
})

Component.model = {
  INCREMENT: (state) => ({ count: state.count + 1 }),
  DECREMENT: (state) => ({ count: state.count - 1 }),
}`

export const greeter = `function Component({ state }) {
  return (
    <div>
      <h2>Hello {state.name}!</h2>
      <input className="name-input" value={state.name} />
    </div>
  )
}

Component.initialState = { name: 'World' }

Component.intent = ({ DOM }) => ({
  CHANGE_NAME: DOM.select('.name-input')
    .events('input')
    .map(e => e.target.value),
})

Component.model = {
  CHANGE_NAME: (state, name) => ({ name }),
}`

export const todo = `function Component({ state }) {
  return (
    <div>
      <h2>Todo List ({state.items.filter(i => !i.done).length} remaining)</h2>
      <div>
        <input className="new-todo" value={state.text} placeholder="Add a task..." />
        <button className="add-btn">Add</button>
      </div>
      <ul>
        {state.items.map((item, i) => (
          <li key={i} style={{
            textDecoration: item.done ? 'line-through' : 'none',
            opacity: item.done ? 0.5 : 1,
            cursor: 'pointer',
            padding: '4px 0',
          }}>
            <span className="todo-item" data-index={i}>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

Component.initialState = {
  text: '',
  items: [
    { text: 'Try editing this code', done: false },
    { text: 'Click a todo to toggle it', done: false },
  ],
}

Component.intent = ({ DOM }) => ({
  UPDATE_TEXT: DOM.select('.new-todo')
    .events('input')
    .map(e => e.target.value),
  ADD: DOM.select('.add-btn').events('click'),
  TOGGLE: DOM.select('.todo-item')
    .events('click')
    .map(e => parseInt(e.target.dataset.index)),
})

Component.model = {
  UPDATE_TEXT: (state, text) => ({ ...state, text }),
  ADD: (state) => {
    if (!state.text.trim()) return state
    return {
      ...state,
      text: '',
      items: [...state.items, { text: state.text, done: false }],
    }
  },
  TOGGLE: (state, index) => ({
    ...state,
    items: state.items.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item
    ),
  }),
}`
