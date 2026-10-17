export default function About({ state }) {
  return <p>{state.text}</p>
}
About.initialState = { text: 'about' }
