function Toolbar({ state }) {
  return (
    <div className="toolbar">
      <label>
        <input type="checkbox" className="hide-done" checked={state.hideDone} />
        Hide done
      </label>
    </div>
  )
}

Toolbar.intent = ({ DOM }) => ({
  SET_HIDE_DONE: DOM.change('.hide-done').checked(),
})

Toolbar.model = {
  SET_HIDE_DONE: (state, hideDone) => ({ ...state, hideDone }),
}

export default Toolbar
