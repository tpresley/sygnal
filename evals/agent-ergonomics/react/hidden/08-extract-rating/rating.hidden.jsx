import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { click, mountApp, waitFor, rowOf, bodyText } from './dom.js'

// The hidden suite always runs with cwd = the trial (app) root.
const src = (file) => path.resolve(process.cwd(), 'src', file)
const read = (file) => fs.readFileSync(src(file), 'utf8')

const starsIn = (label) => [...rowOf(label, 'button', '★').querySelectorAll('button')].filter((b) => b.textContent.includes('★'))
const filledIn = (label) => starsIn(label).filter((b) => b.classList.contains('filled')).length

describe('08 refactor: extract a reusable StarRating component', () => {
  it('src/StarRating.jsx exists and default-exports a component function', async () => {
    expect(fs.existsSync(src('StarRating.jsx'))).toBe(true)
    const mod = await import(/* @vite-ignore */ src('StarRating.jsx'))
    expect(typeof mod.default).toBe('function')
  })

  it('App.jsx uses StarRating and no longer renders the stars itself', () => {
    const app = read('App.jsx')
    expect(app).toMatch(/import\s+StarRating\s+from\s+['"]\.\/StarRating(\.jsx)?['"]/)
    expect(app).toMatch(/<StarRating\b/)
    expect(app).not.toContain('★')
  })

  it('renders both rows with five stars and nothing selected', async () => {
    await mountApp()
    expect(bodyText()).toMatch(/Food: not rated · Service: not rated/)
    expect(starsIn('Food')).toHaveLength(5)
    expect(starsIn('Service')).toHaveLength(5)
    expect(filledIn('Food')).toBe(0)
    expect(filledIn('Service')).toBe(0)
  })

  it('clicking stars updates the right row and the summary', async () => {
    await mountApp()
    await click(starsIn('Food')[3])
    await waitFor(() => expect(bodyText()).toMatch(/Food: 4\/5 · Service: not rated/))
    await waitFor(() => expect(filledIn('Food')).toBe(4))
    expect(filledIn('Service')).toBe(0)

    await click(starsIn('Service')[1])
    await waitFor(() => expect(bodyText()).toMatch(/Food: 4\/5 · Service: 2\/5/))
    await waitFor(() => expect(filledIn('Service')).toBe(2))
    expect(filledIn('Food')).toBe(4)

    await click(starsIn('Food')[0])
    await waitFor(() => expect(bodyText()).toMatch(/Food: 1\/5 · Service: 2\/5/))
    await waitFor(() => expect(filledIn('Food')).toBe(1))
  })
})
