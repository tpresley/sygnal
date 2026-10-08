// The fenced code blocks of a docs page. A fence may carry a meta after its language
// (```jsx live, ```jsx live-file=./Card.jsx, ```css live: docs/src/plugins/remark-live.mjs), so a
// test that looks for a sample on its page matches the code, not the opening line.

/** Every top-level fenced block of `md`: `{ lang, meta, code }` (code ends with its last newline). */
export const codeBlocks = (md) => [...md.matchAll(/^```([\w-]*)(?:[ \t]([^\n]*))?\n([\s\S]*?)^```$/gm)]
  .map((m) => ({ lang: m[1], meta: m[2] ?? '', code: m[3] }))

/** The code of the blocks of language `lang`, for `expect(codesOf(page, 'jsx')).toContain(code)`. */
export const codesOf = (md, lang) => codeBlocks(md).filter((b) => b.lang === lang).map((b) => b.code)
