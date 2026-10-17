// Vike's renderer/ directory applies to every page (outermost: the Wrapper)
export default function Theme({ state, children }) {
  return <div className={state.theme}>{children}</div>
}
Theme.initialState = { theme: 'light' }
