import { emit, event } from 'sygnal'

const helper = emit('ELSEWHERE')

function Saver({ state }) {
  return <button className="save">{state.n}</button>
}
Saver.initialState = { n: 0 }
Saver.intent = ({ DOM }) => ({ SAVE: DOM.click('.save'), RESET: DOM.click('.save') })
Saver.model = {
  SAVE: emit('SAVED', (state) => state.n),
  'RESET | EVENTS': () => ({ type: 'RESET' }),
}
export default Saver
export { helper, event }
