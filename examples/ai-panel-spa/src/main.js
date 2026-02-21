import { run } from 'sygnal'
import RootComponent from './RootComponent.jsx'
import { createKindoDriver } from './createKindoDriver.js'
import { createClipboardDriver } from './createClipboardDriver.js'
import localStorageDriver from './localStorageDriver.js'
import './styles.css'

run(RootComponent, {
  KINDO: createKindoDriver(),
  STORAGE: localStorageDriver,
  CLIPBOARD: createClipboardDriver()
})
