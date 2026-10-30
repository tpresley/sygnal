// The benchmark table's view as JSX, for the compiled-SSR measurement (bench.mjs builds it with
// sygnal({ compile }) off and on)
export function Table({ state }) {
  return (
    <div className="container">
      <div className="table">
        {state.rows.map(row => (
          <div className={row.id === state.selected ? 'row danger' : 'row'} key={row.id} data={{ id: row.id }}>
            <span className="col-id">{row.id}</span>
            <a className="lbl">{row.label}</a>
            <a className="remove">x</a>
          </div>
        ))}
      </div>
    </div>
  )
}
