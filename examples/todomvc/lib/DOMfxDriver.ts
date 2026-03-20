import type { Stream } from 'xstream'

interface DOMfx {
  type: 'SET_VALUE' | 'FOCUS'
  data: {
    selector: string
    value?: string
  }
}

// An extremely simple 'sink only' driver to isolate DOM effects like focus and
// setting input values from the component logic
export default function DOMfxDriver(fx$: Stream<DOMfx>): void {
  fx$.subscribe({
    next: (fx: DOMfx) => {
      const { selector, value } = fx.data
      if (fx.type === 'SET_VALUE') {
        for (const el of document.querySelectorAll(selector)) {
          ;(el as HTMLInputElement).value = value || ''
          el.dispatchEvent(new Event('change'))
        }
      }
      if (fx.type === 'FOCUS') {
        document.querySelector(selector)?.focus()
      }
    },
  })
}
