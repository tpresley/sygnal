// Helpers for the *.browser.jsx tests
export function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

export function equal(actual, expected, message) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message || 'Not equal'}: got ${a}, expected ${e}`)
}

export function waitFor(predicate, message = 'waitFor', timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      let ok = false
      try { ok = predicate() } catch (_) {}
      if (ok) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error(`${message}: timed out`))
      setTimeout(check, 25)
    }
    check()
  })
}

/** real Playwright input: pw('click', selector), pw('type', selector, text), pw('press', selector, key), pw('mouse', null, [x, y]) */
export const pw = (action, selector, arg) => window.__pw(action, selector, arg)

/** the centre of an element in page coordinates */
export function centre(el) {
  const r = el.getBoundingClientRect()
  return [r.left + r.width / 2, r.top + r.height / 2]
}
