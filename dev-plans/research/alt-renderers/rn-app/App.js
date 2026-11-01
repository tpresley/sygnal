// The React Native app: two Sygnal apps (the counter and the todo list) on the native host
import React, { useEffect, useState } from 'react'
import { SafeAreaView, View, Text, Pressable } from 'react-native'
import { run } from 'sygnal'
import { createNativeHost } from './src/nativeHost.jsx'
import Counter from './src/counter.jsx'
import Todos from './src/todos.native.jsx'

function SygnalScreen({ app }) {
  const [tree, setTree] = useState(null)
  useEffect(() => {
    const host = createNativeHost(setTree)
    const running = run(app, { DOM: host.driver })
    return () => { host.stop(); running.dispose() }
  }, [app])
  return tree
}

export default function App() {
  const [screen, setScreen] = useState('counter')
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, paddingVertical: 12 }}>
        {['counter', 'todos'].map((name) => (
          <Pressable key={name} onPress={() => setScreen(name)}>
            <Text style={{ fontSize: 18, fontWeight: screen === name ? '700' : '400' }}>{name}</Text>
          </Pressable>
        ))}
      </View>
      <SygnalScreen app={screen === 'counter' ? Counter : Todos} />
    </SafeAreaView>
  )
}
