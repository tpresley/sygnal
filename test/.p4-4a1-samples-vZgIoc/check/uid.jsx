export function EmailField({ state, uid }) {
  return (
    <p>
      <label for={uid('email')}>Email</label>
      <input id={uid('email')} />
    </p>
  )
}
EmailField.initialState = {}
