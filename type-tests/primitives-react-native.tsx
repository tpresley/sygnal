// sygnal/primitives, sygnal/react-native
import { controls } from 'sygnal'
import { View, Text, Pressable, TextInput, Switch, Image, ScrollView, List, webStyle } from 'sygnal/primitives'
import { SygnalView, createNativeHost, defaultNativeStyles } from 'sygnal/react-native'
import type { NativeStyleRule, NativeComponent } from 'sygnal/react-native'
import { registerFieldTags } from 'sygnal/host'

const { Add, Draft, Done } = controls({ Add: Pressable, Draft: TextInput, Done: Switch })

export function Card({ state }: { state: { title: string, done: boolean, draft: string } }) {
  return (
    <View style={[{ padding: 16 }, state.done && { opacity: 0.5 }]}>
      <Text numberOfLines={1} style={{ fontSize: 18 }}>{state.title}</Text>
      <Image source={{ uri: 'https://example.com/a.png' }} alt="A" style={{ width: 24, height: 24 }} />
      <Draft value={state.draft} placeholder="New" accessibilityLabel="New" keyboardType="email-address" />
      <Done value={state.done} />
      <Add>Add</Add>
      <ScrollView horizontal contentContainerStyle={{ gap: 8 }} />
      <List />
    </View>
  )
}

const rules: NativeStyleRule[] = [['.done', { opacity: 0.5 }], ...defaultNativeStyles]
const chart: NativeComponent = (el, children, style, ctx) => (ctx.press(el), [children, style.view])
const host = createNativeHost({ styles: rules, components: { 'my-chart': chart }, incremental: true, onNodeRender: (el) => el.revision })
host.stop()
SygnalView({ app: Card, styles: rules, onNavigate: (href) => href })
registerFieldTags({ tag: 'toggle', kind: 'checkbox' }, 'textinput')
const css: Record<string, any> | undefined = webStyle({ paddingHorizontal: 4 })
export { css }
