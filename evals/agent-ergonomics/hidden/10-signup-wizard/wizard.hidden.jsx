import { describe, it, expect } from 'vitest'
import { click, mountApp, waitFor, button, bodyText, typeInto, blur, setChecked, sleep } from './dom.js'

const EMAIL_MSG = 'Please enter a valid email address.'
const PASSWORD_MSG = 'Password must be at least 8 characters.'

const email = () => document.querySelector('input[name="email"]')
const password = () => document.querySelector('input[name="password"]')
const plan = (value) => document.querySelector(`input[name="plan"][value="${value}"]`)
const checkedPlan = () => document.querySelector('input[name="plan"]:checked')?.value ?? null

async function fillAccount(emailValue, passwordValue) {
  await typeInto(email(), emailValue)
  await typeInto(password(), passwordValue)
}

async function goToStep2() {
  await fillAccount('ada@example.com', 'correct horse')
  await click(button('Next'))
  await waitFor(() => expect(bodyText()).toMatch(/Step 2 of 2/))
}

describe('10 two-step signup wizard with validation', () => {
  it('starts on step 1 with no messages; a message waits until the user moves on from the field', async () => {
    await mountApp()
    expect(bodyText()).toMatch(/Step 1 of 2/)
    expect(email()).toBeTruthy()
    expect(password()).toBeTruthy()
    expect(plan('free')).toBeNull()
    await typeInto(email(), 'ada')
    await sleep(100)
    expect(bodyText()).not.toContain(EMAIL_MSG)
    expect(bodyText()).not.toContain(PASSWORD_MSG)

    // Moving on to the password field leaves the email field.
    await typeInto(password(), 'short')
    await waitFor(() => expect(bodyText()).toContain(EMAIL_MSG))
    await sleep(100)
    expect(bodyText()).not.toContain(PASSWORD_MSG)
  })

  it("leaving a field shows only that field's message, which then follows the value as the user types", async () => {
    await mountApp()
    await typeInto(email(), 'ada')
    await blur(email())
    await waitFor(() => expect(bodyText()).toContain(EMAIL_MSG))
    expect(bodyText()).not.toContain(PASSWORD_MSG)

    await typeInto(email(), 'ada@example.com')
    await waitFor(() => expect(bodyText()).not.toContain(EMAIL_MSG))
    await typeInto(email(), 'ada@example')
    await waitFor(() => expect(bodyText()).toContain(EMAIL_MSG))
    await typeInto(email(), 'ada lovelace@example.com')
    await waitFor(() => expect(bodyText()).toContain(EMAIL_MSG))
    expect(bodyText()).not.toContain(PASSWORD_MSG)
  })

  it('a field left while valid shows its message as soon as it becomes invalid', async () => {
    await mountApp()
    await typeInto(password(), 'long enough')
    await blur(password())
    await sleep(100)
    expect(bodyText()).not.toContain(PASSWORD_MSG)
    await typeInto(password(), 'short')
    await waitFor(() => expect(bodyText()).toContain(PASSWORD_MSG))
    expect(bodyText()).not.toContain(EMAIL_MSG)
  })

  it('Next with invalid fields stays on step 1 and shows every message', async () => {
    await mountApp()
    await click(button('Next'))
    await waitFor(() => expect(bodyText()).toContain(EMAIL_MSG))
    expect(bodyText()).toContain(PASSWORD_MSG)
    expect(bodyText()).toMatch(/Step 1 of 2/)
    expect(plan('free')).toBeNull()

    await typeInto(password(), '12345678')
    await waitFor(() => expect(bodyText()).not.toContain(PASSWORD_MSG))
    expect(bodyText()).toContain(EMAIL_MSG)
    await click(button('Next'))
    await sleep(100)
    expect(bodyText()).toMatch(/Step 1 of 2/)
    expect(plan('free')).toBeNull()

    await typeInto(email(), 'ada@example.com')
    await waitFor(() => expect(bodyText()).not.toContain(EMAIL_MSG))
    await click(button('Next'))
    await waitFor(() => expect(bodyText()).toMatch(/Step 2 of 2/))
  })

  it('Next goes to step 2 with Free selected, and Back keeps what was typed', async () => {
    await mountApp()
    await goToStep2()
    expect(email()).toBeNull()
    expect(checkedPlan()).toBe('free')
    expect(plan('pro')).toBeTruthy()
    expect(plan('team')).toBeTruthy()

    await click(button('Back'))
    await waitFor(() => expect(bodyText()).toMatch(/Step 1 of 2/))
    await waitFor(() => expect(email().value).toBe('ada@example.com'))
    expect(password().value).toBe('correct horse')
    expect(bodyText()).not.toContain(EMAIL_MSG)
    expect(bodyText()).not.toContain(PASSWORD_MSG)
  })

  it('the chosen plan survives going Back and Next again, and Create account shows the summary', async () => {
    await mountApp()
    await goToStep2()
    await setChecked(plan('pro'), true)
    await waitFor(() => expect(checkedPlan()).toBe('pro'))

    await click(button('Back'))
    await waitFor(() => expect(bodyText()).toMatch(/Step 1 of 2/))
    await typeInto(email(), 'grace@example.org')
    await click(button('Next'))
    await waitFor(() => expect(bodyText()).toMatch(/Step 2 of 2/))
    await waitFor(() => expect(checkedPlan()).toBe('pro'))

    await click(button('Create account'))
    await waitFor(() => expect(bodyText()).toContain('Account created for grace@example.org on the Pro plan.'))
    expect(email()).toBeNull()
    expect(plan('pro')).toBeNull()
    expect(bodyText()).not.toMatch(/Step \d of 2/)
  })

  it('creating an account without touching the plan uses Free; Team works too', async () => {
    await mountApp()
    await goToStep2()
    await click(button('Create account'))
    await waitFor(() => expect(bodyText()).toContain('Account created for ada@example.com on the Free plan.'))

    await mountApp()
    await goToStep2()
    await setChecked(plan('team'), true)
    await click(button('Create account'))
    await waitFor(() => expect(bodyText()).toContain('Account created for ada@example.com on the Team plan.'))
  })
})
