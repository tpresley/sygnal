// The React Native entry (Expo): the same component, on sygnal/react-native
import { createElement as h } from 'react'
import { registerRootComponent } from 'expo'
import { SafeAreaView } from 'react-native'
import { SygnalView } from 'sygnal/react-native'
import Tasks from './src/Tasks.jsx'

function App() {
  return h(SafeAreaView, { style: { flex: 1, backgroundColor: '#ffffff' } }, h(SygnalView, { app: Tasks }))
}

registerRootComponent(App)
