import { event } from 'sygnal'

function Saver({ state }) {
  return <button className="save">{state.n}</button>
}
Saver.initialState = { n: 0 }
Saver.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
Saver.model = {
  SAVE: { EVENTS: event('SAVED', (state) => state.n) },
}
export default Saver
