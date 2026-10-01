// Dynamic class names → info, not warn. Suppression comments silence a finding.
import { set } from 'sygnal'

function Tabs({ state, className }) {
  return (
    <div className={className}>
      <button className={`tab-${state.kind}`}>tab</button>
      <a className="link">link</a>
    </div>
  )
}

Tabs.intent = ({ DOM }) => ({
  ROOT: DOM.click('.tabs-root'), // expect: SYG110 info
  TAB: DOM.click('.tab-main'), // expect: SYG110 info
  // sygnal-ignore SYG110
  TYPO: DOM.click('.lnk'),
  ALSO: DOM.click('.missing'), // sygnal-ignore
})

Tabs.model = {
  ROOT: set({}),
  TAB: set({}),
  TYPO: set({}),
  ALSO: set({}),
}

const SELECTORS = { tab: '.link' }

function Dyn() {
  return <a className="link">x</a>
}

Dyn.intent = ({ DOM }) => ({
  GO: DOM.click(SELECTORS.tab), // expect: SYG110 info
})

Dyn.model = { GO: (s) => s }

export default Tabs
