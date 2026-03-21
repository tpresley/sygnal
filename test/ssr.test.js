import { describe, it, expect } from 'vitest'
import { renderToString } from '../src/extra/ssr.ts'
import { createElement } from '../src/pragma/index.ts'

// Simple counter component
function Counter({ state }) {
  return createElement('div', { className: 'counter' },
    createElement('h1', null, `Count: ${state.count}`),
    createElement('button', { className: 'inc' }, '+')
  )
}
Counter.initialState = { count: 0 }

// Component with context
function Themed({ state, context }) {
  return createElement('div', { className: `theme-${context.theme}` },
    createElement('span', null, state.label)
  )
}
Themed.initialState = { label: 'Hello' }
Themed.context = { theme: (state) => state.label === 'Hello' ? 'light' : 'dark' }

// Component with error boundary
function Broken({ state }) {
  throw new Error('Boom')
}
Broken.initialState = {}
Broken.onError = (err, { componentName }) => {
  return createElement('div', { className: 'error' }, `Error in ${componentName}`)
}

// Component with children/sub-components
function Card({ state, children }) {
  return createElement('div', { className: 'card' },
    createElement('h2', null, state.title),
    ...(children || [])
  )
}
Card.initialState = { title: 'My Card' }

// Component with inline style
function Styled({ state }) {
  return createElement('div', {
    style: { backgroundColor: 'red', fontSize: '16px', marginTop: '10px' }
  }, 'styled')
}
Styled.initialState = {}

// Component with various attributes
function WithAttrs({ state }) {
  return createElement('div', null,
    createElement('input', { type: 'text', disabled: true, value: 'test' }),
    createElement('label', { htmlFor: 'name' }, 'Name'),
    createElement('img', { src: 'logo.png', alt: 'Logo' })
  )
}
WithAttrs.initialState = {}

// Component with data attributes
function WithData({ state }) {
  return createElement('div', { 'data-testid': 'main', 'data-value': '42' }, 'content')
}
WithData.initialState = {}


describe('renderToString', () => {
  describe('basic rendering', () => {
    it('renders a simple component to HTML', () => {
      const html = renderToString(Counter)
      expect(html).toContain('<div')
      expect(html).toContain('class="counter"')
      expect(html).toContain('Count: 0')
      expect(html).toContain('<button')
    })

    it('uses provided state over initialState', () => {
      const html = renderToString(Counter, { state: { count: 42 } })
      expect(html).toContain('Count: 42')
    })

    it('uses initialState when no state provided', () => {
      const html = renderToString(Counter)
      expect(html).toContain('Count: 0')
    })

    it('renders void elements without closing tags', () => {
      const html = renderToString(WithAttrs)
      expect(html).toContain('<input')
      expect(html).not.toContain('</input>')
      expect(html).toContain('<img')
      expect(html).not.toContain('</img>')
    })

    it('renders boolean attributes correctly', () => {
      const html = renderToString(WithAttrs)
      expect(html).toContain('disabled')
    })
  })

  describe('HTML escaping', () => {
    it('escapes text content', () => {
      function XSS({ state }) {
        return createElement('div', null, '<script>alert("xss")</script>')
      }
      XSS.initialState = {}
      const html = renderToString(XSS)
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })

    it('escapes attribute values', () => {
      function AttrXSS({ state }) {
        return createElement('div', { title: '"quotes" & <angles>' }, 'test')
      }
      AttrXSS.initialState = {}
      const html = renderToString(AttrXSS)
      expect(html).toContain('&quot;quotes&quot;')
      expect(html).toContain('&amp;')
    })
  })

  describe('styles', () => {
    it('serializes inline style objects', () => {
      const html = renderToString(Styled)
      expect(html).toContain('style="')
      expect(html).toContain('background-color: red')
      expect(html).toContain('font-size: 16px')
      expect(html).toContain('margin-top: 10px')
    })
  })

  describe('context', () => {
    it('computes context from state', () => {
      const html = renderToString(Themed)
      expect(html).toContain('theme-light')
    })

    it('uses provided context state for context computation', () => {
      const html = renderToString(Themed, { state: { label: 'Dark Mode' } })
      expect(html).toContain('theme-dark')
    })

    it('merges parent context with component context', () => {
      const html = renderToString(Themed, { context: { user: 'Alice' } })
      // Component's own context (theme) should still be computed
      expect(html).toContain('theme-light')
    })
  })

  describe('error boundaries', () => {
    it('renders fallback from onError handler', () => {
      const html = renderToString(Broken)
      expect(html).toContain('class="error"')
      expect(html).toContain('Error in')
    })

    it('renders error div when no onError handler', () => {
      function NoHandler({ state }) { throw new Error('Oops') }
      NoHandler.initialState = {}
      const html = renderToString(NoHandler)
      expect(html).toContain('data-sygnal-error')
    })
  })

  describe('special components', () => {
    it('renders portal children inline', () => {
      function WithPortal({ state }) {
        return createElement('div', null,
          createElement('span', null, 'Before'),
          { sel: 'portal', data: { props: { target: '#modal' } }, children: [
            createElement('div', { className: 'modal-content' }, 'Modal')
          ], text: undefined, elm: undefined, key: undefined },
          createElement('span', null, 'After')
        )
      }
      WithPortal.initialState = {}
      const html = renderToString(WithPortal)
      expect(html).toContain('Before')
      expect(html).toContain('Modal')
      expect(html).toContain('After')
    })

    it('unwraps transition to child', () => {
      function WithTransition({ state }) {
        return createElement('div', null,
          { sel: 'transition', data: { props: { name: 'fade' } }, children: [
            createElement('p', null, 'Animated')
          ], text: undefined, elm: undefined, key: undefined }
        )
      }
      WithTransition.initialState = {}
      const html = renderToString(WithTransition)
      expect(html).toContain('<p>Animated</p>')
      expect(html).not.toContain('transition')
    })

    it('renders suspense children (not fallback)', () => {
      function WithSuspense({ state }) {
        return createElement('div', null,
          { sel: 'suspense', data: { props: { fallback: createElement('span', null, 'Loading...') } }, children: [
            createElement('p', null, 'Content')
          ], text: undefined, elm: undefined, key: undefined }
        )
      }
      WithSuspense.initialState = {}
      const html = renderToString(WithSuspense)
      expect(html).toContain('Content')
      expect(html).not.toContain('Loading')
    })
  })

  describe('sub-components', () => {
    it('renders sub-components via sygnalOptions', () => {
      function Parent({ state }) {
        return createElement('div', null,
          createElement('h1', null, 'Parent'),
          {
            sel: 'ChildComp',
            data: { props: { sygnalOptions: { name: 'ChildComp', view: ChildComp, initialState: { text: 'child content' } } } },
            children: [],
            text: undefined,
            elm: undefined,
            key: undefined,
          }
        )
      }
      Parent.initialState = {}

      function ChildComp({ state }) {
        return createElement('span', null, state.text)
      }
      ChildComp.initialState = { text: 'child content' }

      const html = renderToString(Parent)
      expect(html).toContain('Parent')
      expect(html).toContain('child content')
    })

    it('passes state via state lens', () => {
      function Parent({ state }) {
        return createElement('div', null,
          {
            sel: 'Child',
            data: { props: { sygnalOptions: { name: 'Child', view: Child, initialState: { value: 'default' } }, state: 'childData' } },
            children: [],
            text: undefined,
            elm: undefined,
            key: undefined,
          }
        )
      }
      Parent.initialState = { childData: { value: 'from parent' } }

      function Child({ state }) {
        return createElement('span', null, state.value)
      }
      Child.initialState = { value: 'default' }

      const html = renderToString(Parent)
      expect(html).toContain('from parent')
    })
  })

  describe('collections', () => {
    it('renders collection items from state array', () => {
      function ListItem({ state }) {
        return createElement('li', null, state.name)
      }
      ListItem.initialState = { name: '' }

      function Parent({ state }) {
        return createElement('ul', null,
          { sel: 'collection', data: { props: { of: ListItem, from: 'items' } }, children: [], text: undefined, elm: undefined, key: undefined }
        )
      }
      Parent.initialState = {
        items: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ]
      }

      const html = renderToString(Parent)
      expect(html).toContain('Alice')
      expect(html).toContain('Bob')
      expect(html).toContain('Charlie')
    })

    it('applies className to collection container', () => {
      function Item({ state }) {
        return createElement('div', null, state.label)
      }
      Item.initialState = { label: '' }

      function Parent({ state }) {
        return createElement('div', null,
          { sel: 'collection', data: { props: { of: Item, from: 'list', className: 'item-list' } }, children: [], text: undefined, elm: undefined, key: undefined }
        )
      }
      Parent.initialState = { list: [{ id: 1, label: 'Test' }] }

      const html = renderToString(Parent)
      expect(html).toContain('class="item-list"')
      expect(html).toContain('Test')
    })
  })

  describe('hydration state', () => {
    it('embeds state in script tag when hydrateState is true', () => {
      const html = renderToString(Counter, {
        state: { count: 5 },
        hydrateState: true,
      })
      expect(html).toContain('<script>')
      expect(html).toContain('__SYGNAL_STATE__')
      expect(html).toContain('"count":5')
    })

    it('uses custom variable name when hydrateState is a string', () => {
      const html = renderToString(Counter, {
        state: { count: 3 },
        hydrateState: '__MY_STATE__',
      })
      expect(html).toContain('__MY_STATE__')
    })

    it('does not embed state when hydrateState is not set', () => {
      const html = renderToString(Counter, { state: { count: 1 } })
      expect(html).not.toContain('<script>')
    })

    it('multiple apps with hydrateState: true collide on the same variable', () => {
      const html1 = renderToString(Counter, { state: { count: 1 }, hydrateState: true })
      const html2 = renderToString(Counter, { state: { count: 99 }, hydrateState: true })

      // Both write to __SYGNAL_STATE__ — the second would overwrite the first on the client
      expect(html1).toContain('__SYGNAL_STATE__')
      expect(html2).toContain('__SYGNAL_STATE__')
      expect(html1).toContain('"count":1')
      expect(html2).toContain('"count":99')

      // Simulating what happens in the browser: last one wins
      const combined = html1 + html2
      const matches = combined.match(/__SYGNAL_STATE__/g)
      expect(matches.length).toBe(2) // two assignments to the same variable — collision
    })

    it('multiple apps with unique variable names do not collide', () => {
      function Header({ state }) {
        return createElement('header', null, state.title)
      }
      Header.initialState = { title: 'My Site' }

      function Sidebar({ state }) {
        return createElement('aside', null, state.section)
      }
      Sidebar.initialState = { section: 'Home' }

      const headerHtml = renderToString(Header, {
        state: { title: 'My Site' },
        hydrateState: '__HEADER_STATE__',
      })
      const sidebarHtml = renderToString(Sidebar, {
        state: { section: 'Dashboard' },
        hydrateState: '__SIDEBAR_STATE__',
      })

      // Each writes to its own variable
      expect(headerHtml).toContain('__HEADER_STATE__')
      expect(headerHtml).not.toContain('__SIDEBAR_STATE__')
      expect(sidebarHtml).toContain('__SIDEBAR_STATE__')
      expect(sidebarHtml).not.toContain('__HEADER_STATE__')

      // State is correctly embedded in each
      expect(headerHtml).toContain('"title":"My Site"')
      expect(sidebarHtml).toContain('"section":"Dashboard"')

      // Combined page has both, no collision
      const page = headerHtml + sidebarHtml
      expect(page).toContain('__HEADER_STATE__')
      expect(page).toContain('__SIDEBAR_STATE__')

      // Simulate client-side: eval both scripts, verify independent state
      const scriptPattern = /<script>(.*?)<\/script>/g
      const scripts = []
      let match
      while ((match = scriptPattern.exec(page)) !== null) {
        scripts.push(match[1])
      }
      expect(scripts.length).toBe(2)

      // Execute in a mock window context
      const mockWindow = {}
      for (const script of scripts) {
        new Function('window', script)(mockWindow)
      }
      expect(mockWindow.__HEADER_STATE__).toEqual({ title: 'My Site' })
      expect(mockWindow.__SIDEBAR_STATE__).toEqual({ section: 'Dashboard' })
    })
  })

  describe('selector parsing', () => {
    it('handles tag#id.class selectors', () => {
      function Sel({ state }) {
        return { sel: 'div#main.container.wide', data: {}, children: [{ text: 'content', sel: undefined, data: undefined, children: undefined, elm: undefined, key: undefined }], text: undefined, elm: undefined, key: undefined }
      }
      Sel.initialState = {}
      const html = renderToString(Sel)
      expect(html).toContain('id="main"')
      expect(html).toContain('class="container wide"')
    })

    it('handles tag.class selectors without id', () => {
      function Sel({ state }) {
        return { sel: 'span.highlight', data: {}, children: [{ text: 'hi', sel: undefined, data: undefined, children: undefined, elm: undefined, key: undefined }], text: undefined, elm: undefined, key: undefined }
      }
      Sel.initialState = {}
      const html = renderToString(Sel)
      expect(html).toContain('<span')
      expect(html).toContain('class="highlight"')
    })
  })

  describe('data attributes', () => {
    it('renders data-* attributes from attrs', () => {
      const html = renderToString(WithData)
      expect(html).toContain('data-testid="main"')
      expect(html).toContain('data-value="42"')
    })
  })

  describe('edge cases', () => {
    it('handles component returning null', () => {
      function Empty() { return null }
      Empty.initialState = {}
      const html = renderToString(Empty)
      expect(html).toContain('<div')
    })

    it('handles empty children array', () => {
      function NoKids({ state }) {
        return createElement('div', { className: 'empty' })
      }
      NoKids.initialState = {}
      const html = renderToString(NoKids)
      expect(html).toBe('<div class="empty"></div>')
    })

    it('handles deeply nested components', () => {
      function Level3({ state }) {
        return createElement('span', null, `depth-${state.depth}`)
      }
      Level3.initialState = { depth: 3 }

      function Level2({ state }) {
        return createElement('div', null,
          {
            sel: 'Level3',
            data: { props: { sygnalOptions: { name: 'Level3', view: Level3, initialState: { depth: 3 } } } },
            children: [],
            text: undefined, elm: undefined, key: undefined,
          }
        )
      }
      Level2.initialState = {}

      function Level1({ state }) {
        return createElement('div', null,
          {
            sel: 'Level2',
            data: { props: { sygnalOptions: { name: 'Level2', view: Level2, initialState: {} } } },
            children: [],
            text: undefined, elm: undefined, key: undefined,
          }
        )
      }
      Level1.initialState = {}

      const html = renderToString(Level1)
      expect(html).toContain('depth-3')
    })
  })
})
