import { describe, it, expect } from 'vitest'
import { click, mountApp, waitFor, button, typeInto, bodyText } from './dom.js'

const draft = () => document.querySelector('textarea')

describe('03 status bar follows the editor (cross-component communication)', () => {
  it('shows "Unsaved changes" after the text is edited', async () => {
    await mountApp()
    expect(bodyText()).toMatch(/Ready/)
    await typeInto(draft(), 'hello big world')
    await waitFor(() => expect(bodyText()).toMatch(/Unsaved changes/))
  })

  it('shows the saved word count after Save', async () => {
    await mountApp()
    await typeInto(draft(), 'hello big world')
    await waitFor(() => expect(bodyText()).toMatch(/Unsaved changes/))
    await click(button(/save/i))
    await waitFor(() => expect(bodyText()).toMatch(/Saved 3 words/))
    expect(bodyText()).not.toMatch(/Unsaved changes/)
  })

  it('goes back to "Unsaved changes" on the next edit, and uses the singular for one word', async () => {
    await mountApp()
    await typeInto(draft(), 'one two')
    await click(button(/save/i))
    await waitFor(() => expect(bodyText()).toMatch(/Saved 2 words/))
    await typeInto(draft(), '  solo  ')
    await waitFor(() => expect(bodyText()).toMatch(/Unsaved changes/))
    await click(button(/save/i))
    await waitFor(() => expect(bodyText()).toMatch(/Saved 1 word\b/))
    expect(bodyText()).not.toMatch(/Saved 1 words/)
  })
})
