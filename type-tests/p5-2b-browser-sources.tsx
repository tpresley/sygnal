// PLAN-5 B-3: the `browser` static (typed from STATE & CALCULATED; action names from ACTIONS),
// makeBrowserDriver / makeBrowserDriverWith, the data types, BROWSER commands, t.browser.
import { makeBrowserDriver, makeBrowserDriverWith, intersectionSource, mediaSource, renderComponent, run } from 'sygnal'
import type { RootComponent, Component, BrowserSpec, BrowserSources, BrowserIntersection, BrowserResize, BrowserPosition, BrowserCommand, BrowserFake } from 'sygnal'

type CardState = { seen: boolean; dark: boolean; width: number; theme: string | null; pos: BrowserPosition | null }
type CardActions = {
  SEEN: BrowserIntersection; SIZE: BrowserResize; DARK: { matches: boolean }; THEME: { key: string; value: any }
  VIS: { visible: boolean }; NET: { online: boolean }; POS: BrowserPosition; GEO_ERR: { code: number; message: string }; COPY: null; COPIED: { text: string }
}

export const Card: RootComponent<CardState, {}, CardActions> = ({ state }) => <p>{state.width}</p>
Card.initialState = { seen: false, dark: false, width: 0, theme: null, pos: null }
Card.browser = (state) => ({
  seen: !state.seen && { intersection: '.cover', action: 'SEEN', threshold: [0, 0.5] },
  root: { intersection: true, action: 'SEEN', rootMargin: '100px' },
  size: { resize: '.chart', action: 'SIZE' },
  dark: { media: '(prefers-color-scheme: dark)', action: 'DARK', background: true },
  theme: { storage: 'theme', json: true, area: 'session', action: 'THEME' },
  vis: { visibility: true, action: 'VIS' },
  net: { online: true, action: 'NET' },
  here: { geolocation: { enableHighAccuracy: true }, action: 'POS', error: 'GEO_ERR' },
  off: null,
})
Card.model = {
  SEEN: (state, { visible, ratio, index, dataset }) => ({ ...state, seen: visible && ratio > 0 && index >= 0 && !!dataset }),
  SIZE: (state, { width }) => ({ ...state, width }),
  DARK: (state, { matches }) => ({ ...state, dark: matches }),
  THEME: (state, { value }) => ({ ...state, theme: value }),
  VIS: (state) => state,
  NET: (state) => state,
  POS: (state, pos) => ({ ...state, pos }),
  GEO_ERR: (state) => state,
  COPY: { BROWSER: (state): BrowserCommand => ({ copy: String(state.width), ok: 'COPIED' }) },
  COPIED: (state) => state,
}

// action names come from ACTIONS
// @ts-expect-error no such action
Card.browser = () => ({ x: { media: '(x)', action: 'NOPE' } })
// the state parameter is typed
// @ts-expect-error no such state key
Card.browser = (state) => ({ x: state.missing && { media: '(x)', action: 'DARK' } })
// @ts-expect-error a spec needs a kind
Card.browser = () => ({ x: { action: 'DARK' } })
// @ts-expect-error visibility is true
Card.browser = () => ({ x: { visibility: 'yes', action: 'VIS' } })
// @ts-expect-error a target is a selector or true
Card.browser = () => ({ x: { intersection: 3, action: 'SEEN' } })

// without ACTIONS any action name goes
export const Loose: Component<{ on: boolean }> = () => <p>x</p>
Loose.browser = (state) => ({ x: state.on && { online: true, action: 'ANY' } })

const spec: BrowserSpec<'A'> = { media: '(x)', action: 'A' }
const set: BrowserSources = { a: spec, b: false }
void set

// the drivers: any key, conventionally BROWSER
run(Card, { BROWSER: makeBrowserDriver() })
run(Card, { BROWSER: makeBrowserDriverWith(intersectionSource, mediaSource) })
// @ts-expect-error makeBrowserDriver takes no options
makeBrowserDriver({ media: true })

// t.browser and the options
const t = renderComponent(Card, { browserSink: 'BROWSER', browser: { media: { '(x)': true }, storage: { theme: '"dark"' }, online: false, deny: ['clipboard'], position: { latitude: 1 } } })
const b: BrowserFake = t.browser
async function drive() {
  await b.intersect('.cover', true, { ratio: 0.5, at: 0 })
  await b.intersect(true)
  await b.resize('.chart', { width: 10, height: 5 })
  await b.media('(x)', false)
  await b.storage('theme', { a: 1 }, 'session')
  const raw: string | null = b.storage('theme')
  await b.clipboard('hi')
  const text: string = b.clipboard()
  await b.geolocation({ latitude: 1, longitude: 2 })
  await b.geolocation({ code: 1, message: 'denied' })
  await b.visibility(false)
  await b.online(true)
  b.deny('geolocation')
  const list: Array<Record<string, any>> = b.active()
  void raw; void text; void list
}
void drive
// @ts-expect-error unknown permission
b.deny('camera')
// @ts-expect-error unknown option
renderComponent(Card, { browser: { mediaQueries: {} } })
