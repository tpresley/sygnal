import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import * as dialog from '@zag-js/dialog'
import { zagWidget, zp } from './zag.js'

function App({ state }) {
  return <div>
    <p className="log">{state.log.join(',')}</p>
    <button className="open-ext">open from app</button>
    {zagWidget(dialog, {
      className: 'dlg',
      props: { open: state.open },                // controlled by Sygnal state
      events: ['onOpenChange'],
      render: (api) => <div>
        <button className="trigger" {...zp(api.getTriggerProps())}>Open</button>
        {api.open && <div {...zp(api.getBackdropProps())} />}
        <div {...zp(api.getPositionerProps())}>
          <div {...zp(api.getContentProps())}>
            <h2 {...zp(api.getTitleProps())}>Title</h2>
            <button className="close" {...zp(api.getCloseTriggerProps())}>x</button>
          </div>
        </div>
      </div>,
    })}
  </div>
}
App.initialState = { open: false, log: [] }
App.intent = ({ DOM }) => ({
  OPEN_CHANGE: DOM.select('.dlg').events('onOpenChange').map(e => e.detail.open),
  OPEN_EXT: DOM.click('.open-ext'),
})
App.model = {
  OPEN_CHANGE: (s, open) => ({ ...s, open, log: [...s.log, open ? 'opened' : 'closed'] }),
  OPEN_EXT: (s) => ({ ...s, open: true }),
}

let t; afterEach(() => t?.dispose())
it('Zag dialog machine drives Sygnal JSX; state flows both ways', async () => {
  t = renderComponent(App, { dom: 'real' })
  await t.ready()
  const content = () => t.query('[role="dialog"]')
  expect(content().hidden).toBe(true)
  expect(t.query('.trigger').getAttribute('aria-haspopup')).toBe('dialog')
  t.query('.trigger').click()                                      // Zag handles the click → onOpenChange → action
  await t.next(s => s.open === true)
  expect(content().hidden).toBe(false)
  expect(content().getAttribute('aria-labelledby')).toBe(t.query('h2').id)
  document.querySelector('.close').click()
  await t.next(s => s.open === false)
  expect(content().hidden).toBe(true)
  t.query('.open-ext').click()                                     // app state → controlled prop → machine
  await t.next(s => s.open === true)
  await new Promise(r => setTimeout(r, 20))
  expect(content().hidden).toBe(false)
  content().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))  // Zag's Escape dismissal
  await t.next(s => s.open === false)
  expect(t.state.log).toEqual(['opened', 'closed', 'closed'])
})
