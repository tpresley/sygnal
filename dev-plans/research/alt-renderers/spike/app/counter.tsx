/** One component, one view, three renderers: the primitives carry the whole difference. */
import {controls} from 'sygnal'
import {View, Row, Txt, Pressable} from '../primitives'

export const {Inc, Dec, Reset} = controls({Inc: Pressable, Dec: Pressable, Reset: Pressable})

export default function Counter({state}: any) {
  return (
    <View className="counter">
      <Txt className="count">Count: {state.count}</Txt>
      <Row>
        <Dec>-</Dec>
        <Inc>+</Inc>
        <Reset>reset</Reset>
      </Row>
    </View>
  )
}

Counter.initialState = {count: 0}
Counter.intent = ({DOM}: any) => ({INC: DOM.click(Inc), DEC: DOM.click(Dec), RESET: DOM.click(Reset)})
Counter.model = {
  INC: (s: any) => ({count: s.count + 1}),
  DEC: (s: any) => ({count: s.count - 1}),
  RESET: () => ({count: 0}),
}
