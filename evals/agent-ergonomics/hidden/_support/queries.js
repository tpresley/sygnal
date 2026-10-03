// Framework-neutral DOM queries shared by both arms' hidden tests.
// hidden/_support/queries.js and react/hidden/_support/queries.js must stay
// byte-identical (verify.mjs checks), so both arms are judged the same way.

// Captured at load, so pauses and waitFor run on real time even while a test
// has installed fake timers (vi.useFakeTimers(); the ergo tier's tasks 26-28).
const realSetTimeout = globalThis.setTimeout
const realNow = Date.now

export function sleep(ms) {
  return new Promise((resolve) => realSetTimeout(resolve, ms))
}

/** Retry `fn` until it stops throwing (and does not return false) or times out. */
export async function waitFor(fn, { timeout = 1500, interval = 10 } = {}) {
  const start = realNow()
  let lastError
  for (;;) {
    try {
      const result = fn()
      if (result !== false) return result
      lastError = new Error('waitFor: callback returned false')
    } catch (err) {
      lastError = err
    }
    if (realNow() - start > timeout) throw lastError
    await sleep(interval)
  }
}

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()

/**
 * Approximate innerText (jsdom has none): adjacent text nodes are concatenated
 * as-is ("$" + "12.50" -> "$12.50"), element boundaries become spaces.
 */
export function textOf(el) {
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return ''
    return ' ' + [...node.childNodes].map(walk).join('') + ' '
  }
  return norm(walk(el))
}

export function bodyText() {
  return textOf(document.body)
}

/** All elements matching `selector` whose text matches `text` (string = substring, or RegExp). */
export function allByText(selector, text, root = document.body) {
  const matches = (el) => {
    const t = textOf(el)
    return typeof text === 'string' ? t.includes(text) : text.test(t)
  }
  return [...root.querySelectorAll(selector)].filter(matches)
}

/** The innermost element matching `selector` whose text matches `text`. Throws if none. */
export function getByText(selector, text, root = document.body) {
  const found = allByText(selector, text, root)
  const innermost = found.filter((el) => !found.some((other) => other !== el && el.contains(other)))
  if (innermost.length === 0) {
    throw new Error(`No <${selector}> with text ${text} in: ${bodyText()}`)
  }
  return innermost[0]
}

export function queryByText(selector, text, root = document.body) {
  try {
    return getByText(selector, text, root)
  } catch {
    return null
  }
}

export function button(text, root = document.body) {
  return getByText('button', text, root)
}

/** The smallest element matching `containerSelector` that contains `text`. */
export function rowContaining(text, containerSelector = 'li') {
  return getByText(containerSelector, text)
}

/**
 * The smallest element that contains `text` and also contains an element
 * matching `innerSelector` (optionally with text `innerText`).
 * Markup-agnostic way to find "the row for 'Walk the dog'".
 */
export function rowOf(text, innerSelector, innerText) {
  const candidates = allByText('*', text).filter((el) =>
    innerText === undefined ? el.querySelector(innerSelector) : allByText(innerSelector, innerText, el).length > 0
  )
  const smallest = candidates.filter((el) => !candidates.some((o) => o !== el && el.contains(o)))
  if (smallest.length === 0) {
    throw new Error(`No element containing "${text}" with <${innerSelector}> ${innerText ?? ''} in: ${bodyText()}`)
  }
  return smallest[0]
}

/** The `innerSelector` element inside rowOf(...), e.g. "the Pin button in the 'Walk the dog' row". */
export function within(text, innerSelector, innerText) {
  const scope = rowOf(text, innerSelector, innerText)
  return innerText === undefined ? scope.querySelector(innerSelector) : getByText(innerSelector, innerText, scope)
}

/** Pause between simulated user interactions, like a human (render frames happen in between). */
export const HUMAN_PAUSE_MS = 50

/**
 * Source text with JS comments (`// ...`, `/* ... *\/`, JSX `{/* ... *\/}`)
 * removed, for static "the file no longer contains X" checks: a comment that
 * mentions "Place order" doesn't render it (G-124). Strings and template
 * literals are kept. A quote or regex the scanner misreads ends at the line
 * break, so a misread can only touch one line. Use it for negative checks;
 * positive checks can keep reading the raw source.
 */
export function stripComments(code) {
  let out = ''
  let i = 0
  const n = code.length
  const braces = [] // open template literals: `{` depth inside each one's current `${ ... }`
  while (i < n) {
    const c = code[i]
    const d = code[i + 1]
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++
    } else if (c === '/' && d === '*') {
      const end = code.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      out += code.slice(i, stop).includes('\n') ? '\n' : ' '
      i = stop
    } else if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
      out += code.slice(i, j + 1)
      i = j + 1
    } else if (c === '`' || (c === '}' && braces.length && braces[braces.length - 1] === 0)) {
      if (c === '}') braces.pop()
      let j = i + 1
      while (j < n && code[j] !== '`' && !(code[j] === '$' && code[j + 1] === '{')) j += code[j] === '\\' ? 2 : 1
      if (code[j] === '$') {
        braces.push(0)
        out += code.slice(i, j + 2)
        i = j + 2
      } else {
        out += code.slice(i, j + 1)
        i = j + 1
      }
    } else {
      if (braces.length && c === '{') braces[braces.length - 1]++
      else if (braces.length && c === '}') braces[braces.length - 1]--
      out += c
      i++
    }
  }
  return out
}
