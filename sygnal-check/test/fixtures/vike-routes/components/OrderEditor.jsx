// one component, the +Page of two directories
export default function OrderEditor({ state }) {
  return <form>{state.draft}</form>
}
OrderEditor.initialState = { draft: '' }
