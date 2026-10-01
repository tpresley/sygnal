function BookRow({ state }) {
  return (
    <li className={state.finished ? 'book finished' : 'book'}>
      <label>
        <input type="checkbox" className="finished-toggle" checked={state.finished} />
        Finished
      </label>
      <span className="title">{state.title}</span>
      <button className="remove">Remove</button>
    </li>
  )
}

BookRow.intent = ({ DOM }) => ({
  SET_FINISHED: DOM.change('.finished-toggle').checked(),
  REMOVE: DOM.click('.remove'),
})

BookRow.model = {
  SET_FINISHED: (state, finished) => ({ ...state, finished }),
  REMOVE: () => undefined,
}

export default BookRow
