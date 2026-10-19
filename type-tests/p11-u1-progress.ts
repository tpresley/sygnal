/**
 * PLAN-11 U-1/U-2 type tests: `progress` on a request, FetchProgress, HTTP.progress(),
 * t.progress(). Compiled by `npm run test:types`; never executed.
 */
import { makeFetchDriver, renderComponent } from 'sygnal'
import type { FetchRequest, FetchProgress, FetchSource } from 'sygnal'

export const a: FetchRequest = { url: '/upload', body: new FormData(), progress: 'UPLOADING', ok: 'UPLOADED' }
export const b: FetchRequest = { url: '/upload', body: 'x', category: 'up', progress: true }
// PLAN-11 U-5: multipart as data
declare const file: File
export const m1: FetchRequest = { url: '/upload', multipart: { file, title: 'x', n: 2, files: [file, file], none: null }, progress: 'UPLOADING', ok: 'UPLOADED' }
// @ts-expect-error multipart is an object of parts, not a FormData-less string
export const m2: FetchRequest = { url: '/upload', multipart: 'file' }
// @ts-expect-error progress is an action name or true
export const c: FetchRequest = { url: '/upload', progress: false }

declare const HTTP: FetchSource
export const steps = HTTP.progress('up').map((p: FetchProgress) => {
  const f: number | null = p.fraction
  const phase: 'upload' | 'download' = p.phase
  return [f, phase, p.loaded, p.total]
})

export const driver = makeFetchDriver({ XMLHttpRequest: globalThis.XMLHttpRequest })

declare const App: any
export async function test() {
  const t = renderComponent(App)
  await t.progress('HTTP', { loaded: 1, total: 2 }, 'UPLOADING')
  await t.progress('HTTP', { loaded: 1, phase: 'download' })
}
