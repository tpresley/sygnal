'use strict'

import { xs, dropRepeats } from 'sygnal'

export default function localStorageDriver (fx$) {
  fx$.addListener({next: ({key, value}) => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch(e) {
      console.log(e)
    }
  }})

  return {
    get: (key, defaultValue, emitChanges=false) => {
      const fromStorage = window.localStorage.getItem(key)
      let parsed
      try {
        parsed = (fromStorage && fromStorage != "null") ? JSON.parse(fromStorage) : defaultValue
      } catch (e) {
        console.log('Error reading from local storage')
        parsed = defaultValue
      }

      if (emitChanges) {
        return fx$.filter(({key: key_, value}) => key == key_)
                  .map(({value}) => value)
                  .compose(dropRepeats())
                  .startWith(parsed)
      } else {
        return xs.of(parsed)
      }
    }
  }
}