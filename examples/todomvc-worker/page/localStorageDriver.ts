// lib/localStorageDriver's page-side copy: the same driver on plain xstream, so the page doesn't
// load the Sygnal core for it (the app imports only its types from lib/)
import xs from 'xstream'
import dropRepeats from 'xstream/extra/dropRepeats'
import type { Stream } from 'xstream'
import type { StoreEntry, StoreSource } from '../lib/localStorageDriver'

export default function localStorageDriver(fx$: Stream<StoreEntry>): StoreSource {
  fx$.addListener({
    next: ({ key, value }: StoreEntry) => {
      try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) { console.log(e) }
    },
  })
  return {
    get: (key: string, defaultValue: any = undefined, emitChanges = false): Stream<any> => {
      const fromStorage = window.localStorage.getItem(key)
      let parsed: any
      try {
        parsed = fromStorage && fromStorage !== 'null' ? JSON.parse(fromStorage) : defaultValue
      } catch {
        parsed = defaultValue
      }
      if (!emitChanges) return xs.of(parsed)
      return fx$.filter((e) => e.key === key).map((e) => e.value).compose(dropRepeats()).startWith(parsed)
    },
  }
}
