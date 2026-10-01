import { describe, it, expect } from 'vitest'
import { click, mountApp, waitFor, within, rowOf, bodyText, textOf } from './dom.js'

const line = (name) => textOf(rowOf(name, 'button', '+'))
const plus = (name) => within(name, 'button', '+')
const minus = (name) => within(name, 'button', '-')

describe('04 derived values: cart total and per-line share', () => {
  it('shows the initial total', async () => {
    await mountApp()
    expect(bodyText()).toMatch(/Total: \$37\.00/)
  })

  it('shows each line share of the total', async () => {
    await mountApp()
    expect(line('Coffee beans')).toMatch(/\(68%\)/)
    expect(line('Mug')).toMatch(/\(22%\)/)
    expect(line('Filter papers')).toMatch(/\(11%\)/)
  })

  it('updates the total and every share when a quantity goes up', async () => {
    await mountApp()
    await click(plus('Mug'))
    await waitFor(() => expect(bodyText()).toMatch(/Total: \$45\.00/))
    await waitFor(() => {
      expect(line('Coffee beans')).toMatch(/\(56%\)/)
      expect(line('Mug')).toMatch(/\(36%\)/)
      expect(line('Filter papers')).toMatch(/\(9%\)/)
    })
  })

  it('updates when a quantity goes down', async () => {
    await mountApp()
    await click(minus('Coffee beans'))
    await waitFor(() => expect(bodyText()).toMatch(/Total: \$24\.50/))
    await waitFor(() => {
      expect(line('Coffee beans')).toMatch(/\(51%\)/)
      expect(line('Mug')).toMatch(/\(33%\)/)
      expect(line('Filter papers')).toMatch(/\(16%\)/)
    })
  })
})
