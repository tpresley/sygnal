import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountApp, advance, click, setChecked, typeInto, pressKey, textOf, getByText } from './dom.js'

// Fake timers (Date included), so typing bursts are timed exactly: every interaction
// helper advances the clock by 50 ms, and advance(ms) moves it further.

beforeEach(async () => {
  vi.useFakeTimers()
  await mountApp()
})

afterEach(() => {
  vi.useRealTimers()
})

const q = (sel) => document.querySelector(sel)
const headline = () => q('input[name="headline"]')
const bold = () => q('input[name="bold"]')
const preview = () => textOf(q('.preview'))
const undoButton = () => q('.toolbar button.undo')
const redoButton = () => q('.toolbar button.redo')

const larger = () => click(getByText('button', 'Larger'))
const smaller = () => click(getByText('button', 'Smaller'))
const undo = () => click(undoButton())
const redo = () => click(redoButton())

/** The poster as shown: preview text, field value and checkbox state must agree. */
function expectPoster(text, size, isBold) {
  expect(preview()).toBe(`${text} (${size}px${isBold ? ', bold' : ''})`)
  expect(headline().value).toBe(text)
  expect(bold().checked).toBe(isBold)
}

function expectButtons({ canUndo, canRedo }) {
  expect(undoButton().disabled).toBe(!canUndo)
  expect(redoButton().disabled).toBe(!canRedo)
}

describe('27 undo editor: steps, grouped typing, redo, disabled buttons and shortcuts', () => {
  it('starts with both buttons disabled; Undo and Redo step through one change', async () => {
    expect(textOf(undoButton())).toBe('Undo')
    expect(textOf(redoButton())).toBe('Redo')
    expectPoster('Summer sale', 28, false)
    expectButtons({ canUndo: false, canRedo: false })

    await larger()
    expectPoster('Summer sale', 30, false)
    expectButtons({ canUndo: true, canRedo: false })
    await undo()
    expectPoster('Summer sale', 28, false)
    expectButtons({ canUndo: false, canRedo: true })
    await redo()
    expectPoster('Summer sale', 30, false)
    expectButtons({ canUndo: true, canRedo: false })
  })

  it('undoes a mixed sequence one step at a time and redoes it in order', async () => {
    await larger() // 30
    await setChecked(bold(), true)
    await smaller() // 28
    await smaller() // 26
    expectPoster('Summer sale', 26, true)

    await undo()
    expectPoster('Summer sale', 28, true)
    await undo()
    expectPoster('Summer sale', 30, true)
    await undo()
    expectPoster('Summer sale', 30, false)
    await undo()
    expectPoster('Summer sale', 28, false)
    expectButtons({ canUndo: false, canRedo: true })

    await redo()
    expectPoster('Summer sale', 30, false)
    await redo()
    expectPoster('Summer sale', 30, true)
    await redo()
    await redo()
    expectPoster('Summer sale', 26, true)
    expectButtons({ canUndo: true, canRedo: false })
  })

  it('a new change after Undo discards the steps that could have been redone', async () => {
    await larger() // 30
    await larger() // 32
    await undo() // 30
    expectButtons({ canUndo: true, canRedo: true })
    await setChecked(bold(), true)
    expectPoster('Summer sale', 30, true)
    expectButtons({ canUndo: true, canRedo: false })
    await pressKey('y', document.body, { ctrlKey: true })
    expectPoster('Summer sale', 30, true)

    await undo()
    expectPoster('Summer sale', 30, false)
    await undo()
    expectPoster('Summer sale', 28, false)
    expectButtons({ canUndo: false, canRedo: true })
  })

  it('a click that changes nothing is not a step', async () => {
    await larger() // 30
    await larger() // 32
    await larger() // still 32
    await larger() // still 32
    await undo()
    expectPoster('Summer sale', 30, false)
    await undo()
    expectPoster('Summer sale', 28, false)
    expectButtons({ canUndo: false, canRedo: true })

    for (let i = 0; i < 6; i++) await smaller() // 26 ... 16
    expectPoster('Summer sale', 16, false)
    await smaller() // still 16
    await undo()
    expectPoster('Summer sale', 18, false)
  })

  it('typing is one step per burst: a 1 s pause or another change starts a new step', async () => {
    // A long burst, each edit less than 1 s after the previous one: one step.
    await typeInto(headline(), 'W')
    await advance(550)
    await typeInto(headline(), 'Winter')
    await advance(850)
    await typeInto(headline(), 'Winter sale')
    expectButtons({ canUndo: true, canRedo: false })
    // A pause of 1 s: a new step.
    await advance(1000)
    await typeInto(headline(), 'Winter sale!')
    // Bold ends the group, so the next edit (soon after the previous one) is a new step.
    await setChecked(bold(), true)
    await typeInto(headline(), 'Winter sale!!')
    await typeInto(headline(), 'Winter sale!!!')
    expectPoster('Winter sale!!!', 28, true)

    await undo()
    expectPoster('Winter sale!', 28, true)
    await undo()
    expectPoster('Winter sale!', 28, false)
    await undo()
    expectPoster('Winter sale', 28, false)
    await undo()
    expectPoster('Summer sale', 28, false)
    expectButtons({ canUndo: false, canRedo: true })

    await redo()
    expectPoster('Winter sale', 28, false)
  })

  it('Undo and Redo end a typing group: the next edit is a new step', async () => {
    await typeInto(headline(), 'Summer sale today')
    await undo()
    expectPoster('Summer sale', 28, false)
    await typeInto(headline(), 'Summer sale now')
    expectButtons({ canUndo: true, canRedo: false })
    await undo()
    expectPoster('Summer sale', 28, false)
    await redo()
    expectPoster('Summer sale now', 28, false)
    await typeInto(headline(), 'Summer sale now!')
    await undo()
    expectPoster('Summer sale now', 28, false)
    await undo()
    expectPoster('Summer sale', 28, false)
    expectButtons({ canUndo: false, canRedo: true })
  })

  it('keyboard shortcuts work anywhere, also in the field, and prevent the default', async () => {
    await larger() // 30
    await setChecked(bold(), true)

    let e = await pressKey('z', document.body, { ctrlKey: true })
    expectPoster('Summer sale', 30, false)
    expect(e.defaultPrevented).toBe(true)

    headline().focus()
    e = await pressKey('z', headline(), { metaKey: true })
    expectPoster('Summer sale', 28, false)
    expect(e.defaultPrevented).toBe(true)
    expectButtons({ canUndo: false, canRedo: true })

    e = await pressKey('Z', headline(), { ctrlKey: true, shiftKey: true })
    expectPoster('Summer sale', 30, false)
    expect(e.defaultPrevented).toBe(true)
    e = await pressKey('y', document.body, { ctrlKey: true })
    expectPoster('Summer sale', 30, true)
    expect(e.defaultPrevented).toBe(true)
    await pressKey('z', document.body, { ctrlKey: true })
    e = await pressKey('Z', document.body, { metaKey: true, shiftKey: true })
    expectPoster('Summer sale', 30, true)
    expect(e.defaultPrevented).toBe(true)

    // Plain keys are left alone.
    e = await pressKey('z', headline())
    expect(e.defaultPrevented).toBe(false)
    e = await pressKey('y', document.body)
    expect(e.defaultPrevented).toBe(false)
    expectPoster('Summer sale', 30, true)
    expectButtons({ canUndo: true, canRedo: false })
  })
})
