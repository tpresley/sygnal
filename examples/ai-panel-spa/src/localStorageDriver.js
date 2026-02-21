import { xs, dropRepeats } from 'sygnal'

export default function localStorageDriver(fx$) {
  fx$.addListener({
    next: ({ key, value }) => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (error) {
        console.log(error)
      }
    },
    error: () => {},
    complete: () => {}
  })

  return {
    get: (key, defaultValue, emitChanges = false) => {
      const fromStorage = window.localStorage.getItem(key)
      let parsed

      try {
        parsed = (fromStorage && fromStorage !== 'null') ? JSON.parse(fromStorage) : defaultValue
      } catch (_error) {
        console.log('Error reading from local storage')
        parsed = defaultValue
      }

      if (emitChanges) {
        return fx$
          .filter(({ key: incomingKey }) => key === incomingKey)
          .map(({ value }) => value)
          .compose(dropRepeats())
          .startWith(parsed)
      }

      return xs.of(parsed)
    }
  }
}
