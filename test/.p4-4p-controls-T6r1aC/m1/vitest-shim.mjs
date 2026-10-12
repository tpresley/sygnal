export { expect, vi } from 'vitest'
export const registered = { tests: [] }
export const it = (name, fn) => { registered.tests.push([name, fn]) }
