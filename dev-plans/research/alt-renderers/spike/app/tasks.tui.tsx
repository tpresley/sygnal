/** The terminal layout: status line first, no Add button (Enter adds), key hints last */
import {Collection} from 'sygnal'
import {View, Row, Txt} from '../primitives'
import {TaskLogic, TasksLogic, Draft, ClearDone, Done, Remove, withView} from './tasks.logic'

export const Task = withView(TaskLogic, function Task({state}: any) {
  return (
    <Row className="task">
      <Done checked={state.done} />
      <Txt>{state.title}</Txt>
      <Remove>del</Remove>
    </Row>
  )
})

export default withView(TasksLogic, function Tasks({state}: any) {
  return (
    <View>
      <Txt>TASKS ({state.left} open)</Txt>
      <View><Draft value={state.draft} placeholder="type, Enter to add" /></View>
      <Collection of={Task} from="tasks" />
      <View><ClearDone>clear done</ClearDone></View>
      <View><Txt className="hint">Tab: move  Space: toggle  Enter: activate</Txt></View>
    </View>
  )
})
