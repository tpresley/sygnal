// Sift: the renderComponent handle is disposable (`using`) and cleanup() is exported
import { renderComponent, cleanup } from 'sygnal'

function Counter({ state }: { state: { count: number } }) { return null as any }
Counter.initialState = { count: 0 }

export function sync() {
  using t = renderComponent(Counter, { autoDispose: false, strict: true })
  const n: number = t.state.count
  t[Symbol.dispose]()
  return n
}

export async function asyncUse() {
  await using t = renderComponent(Counter)
  const p: Promise<void> = t[Symbol.asyncDispose]()
  await p
}

const c: () => void = cleanup
// @ts-expect-error autoDispose is a boolean
renderComponent(Counter, { autoDispose: 'no' })
