import { xs, dropRepeats } from 'sygnal'
import type { Stream } from 'xstream'

interface StoreEntry {
  key: string
  value: any
}

interface StoreSource {
  get(key: string, defaultValue?: any, emitChanges?: boolean): Stream<any>
}

export default function localStorageDriver(fx$: Stream<StoreEntry>): StoreSource {
  fx$.addListener({
    next: ({ key, value }: StoreEntry) => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        console.log(e)
      }
    },
  })

  return {
    get: (key: string, defaultValue: any = undefined, emitChanges = false): Stream<any> => {
      const fromStorage = window.localStorage.getItem(key)
      let parsed: any
      try {
        parsed = fromStorage && fromStorage !== 'null' ? JSON.parse(fromStorage) : defaultValue
      } catch (e) {
        console.log('Error reading from local storage')
        parsed = defaultValue
      }

      if (emitChanges) {
        return fx$
          .filter(({ key: key_ }: StoreEntry) => key === key_)
          .map(({ value }: StoreEntry) => value)
          .compose(dropRepeats())
          .startWith(parsed)
      } else {
        return xs.of(parsed)
      }
    },
  }
}
